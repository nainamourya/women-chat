import { randomUUID } from "node:crypto";
import { and, eq, inArray, or } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";
import { closeDb, db } from "../db/client.js";
import {
  comments,
  conversations,
  directMessages,
  follows,
  notifications,
  postLikes,
  posts,
  userProfiles,
  users,
} from "../db/schema.js";
import { createMember } from "../testUtils/socialFixtures.js";
import { deleteAccount } from "./accountDeletion.service.js";

// Storage is replaced so the test can see which image objects were removed.
const removed = vi.hoisted(() => [] as string[]);
vi.mock("./social/mediaStorage.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("./social/mediaStorage.js")>();
  return { ...real, deleteMedia: async (key: string) => void removed.push(key) };
});

const created: string[] = [];

afterAll(async () => {
  if (created.length > 0) await db.delete(users).where(inArray(users.id, created));
  await closeDb();
});

async function addPost(authorId: string, caption: string) {
  const id = randomUUID();
  await db.insert(posts).values({ id, authorId, caption, imageKey: `social/posts/${id}.jpg`, imageMimeType: "image/jpeg" });
  return { id, imageKey: `social/posts/${id}.jpg` };
}

describe("deleteAccount removes a member's social data", () => {
  it("erases their posts, comments, likes, follows, notifications, bio, handle and photo, and leaves everyone else's data", async () => {
    const gone = await createMember(created);
    const friend = await createMember(created);
    const bystander = await createMember(created);
    const avatarKey = `social/avatars/${randomUUID()}.jpg`;
    await db.update(users).set({ avatarKey }).where(eq(users.id, gone.id));
    const goneUsername = gone.username!;
    await db.insert(userProfiles).values({ userId: gone.id, bio: "private details about me" });

    const goneUsersPost = await addPost(gone.id, "mine");
    const friendsPost = await addPost(friend.id, "friend's post");
    // Interactions in both directions.
    await db.insert(follows).values([
      { followerId: gone.id, followeeId: friend.id },
      { followerId: friend.id, followeeId: gone.id },
      { followerId: bystander.id, followeeId: friend.id },
    ]);
    await db.insert(postLikes).values([
      { postId: friendsPost.id, userId: gone.id },
      { postId: goneUsersPost.id, userId: friend.id },
      { postId: friendsPost.id, userId: bystander.id },
    ]);
    await db.insert(comments).values([
      { postId: friendsPost.id, authorId: gone.id, content: "gone's comment" },
      { postId: friendsPost.id, authorId: bystander.id, content: "bystander comment" },
      { postId: goneUsersPost.id, authorId: friend.id, content: "comment on gone's post" },
    ]);
    await db.insert(notifications).values([
      { userId: friend.id, actorId: gone.id, type: "follow", dedupeKey: `follow:${gone.id}` },
      { userId: gone.id, actorId: friend.id, type: "follow", dedupeKey: `follow:${friend.id}` },
      { userId: friend.id, actorId: bystander.id, type: "follow", dedupeKey: `follow:${bystander.id}` },
    ]);
    const [a, b] = [gone.id, friend.id].sort();
    const [conversation] = await db.insert(conversations).values({ userAId: a!, userBId: b! }).returning();
    await db.insert(directMessages).values([
      { conversationId: conversation!.id, senderId: gone.id, content: "my private words", postId: friendsPost.id },
      { conversationId: conversation!.id, senderId: friend.id, content: "friend's reply" },
    ]);

    expect(await deleteAccount(gone.id)).toEqual({ alreadyDeleted: false });

    // Their content is gone.
    expect(await db.select().from(posts).where(eq(posts.authorId, gone.id))).toHaveLength(0);
    expect(await db.select().from(comments).where(eq(comments.authorId, gone.id))).toHaveLength(0);
    expect(await db.select().from(postLikes).where(eq(postLikes.userId, gone.id))).toHaveLength(0);
    expect(await db.select().from(follows).where(or(eq(follows.followerId, gone.id), eq(follows.followeeId, gone.id)))).toHaveLength(0);
    expect(await db.select().from(notifications).where(or(eq(notifications.userId, gone.id), eq(notifications.actorId, gone.id)))).toHaveLength(0);
    // The things attached to their post went with it.
    expect(await db.select().from(comments).where(eq(comments.postId, goneUsersPost.id))).toHaveLength(0);
    expect(await db.select().from(postLikes).where(eq(postLikes.postId, goneUsersPost.id))).toHaveLength(0);

    // Their messages stay in the other person's history, with the words replaced.
    const messagesLeft = await db.select().from(directMessages).where(eq(directMessages.conversationId, conversation!.id));
    expect(messagesLeft.find((m) => m.senderId === gone.id)).toMatchObject({ content: "[message removed — sender deleted their account]", postId: null });
    expect(messagesLeft.find((m) => m.senderId === friend.id)!.content).toBe("friend's reply");
    expect(JSON.stringify(messagesLeft)).not.toContain("my private words");

    // Profile, handle and photo.
    const [row] = await db.select().from(users).where(eq(users.id, gone.id));
    expect(row).toMatchObject({ accountStatus: "deleted", username: null, avatarKey: null, displayName: "Deleted user" });
    expect((await db.select().from(userProfiles).where(eq(userProfiles.userId, gone.id)))[0]!.bio).toBeNull();
    expect(removed).toEqual(expect.arrayContaining([goneUsersPost.imageKey, avatarKey]));
    expect(removed).not.toContain(friendsPost.imageKey);

    // Everyone else's data is untouched.
    expect(await db.select().from(posts).where(eq(posts.id, friendsPost.id))).toHaveLength(1);
    expect((await db.select().from(comments).where(eq(comments.authorId, bystander.id))).map((c) => c.content)).toEqual(["bystander comment"]);
    expect(await db.select().from(follows).where(and(eq(follows.followerId, bystander.id), eq(follows.followeeId, friend.id)))).toHaveLength(1);
    expect(await db.select().from(postLikes).where(and(eq(postLikes.postId, friendsPost.id), eq(postLikes.userId, bystander.id)))).toHaveLength(1);
    expect(await db.select().from(notifications).where(eq(notifications.actorId, bystander.id))).toHaveLength(1);

    // The handle can be claimed again, and deleting twice is a harmless no-op.
    const reuse = await createMember(created, { username: goneUsername });
    expect(reuse.username).toBe(goneUsername);
    expect(await deleteAccount(gone.id)).toEqual({ alreadyDeleted: true });
  });
});
