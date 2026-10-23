import { eq } from "drizzle-orm";
import { Router, type NextFunction, type Request, type RequestHandler, type Response } from "express";
import { z } from "zod";
import { db } from "../db/client.js";
import { posts, users } from "../db/schema.js";
import { requireInternalSecret } from "../middleware/internalAuth.js";
import { checkLimitFailOpen, sendRateLimitedResponse } from "../redis/rateLimit.js";
import { AuthError } from "../services/auth.service.js";
import { blockUser, unblockUser } from "../services/blocks.service.js";
import { createReport } from "../services/reports.service.js";
import { SocialError, findVisibleMemberByUsername, loadViewer } from "../services/social/access.js";
import { followMember, listFollowers, listFollowing, unfollowMember } from "../services/social/follows.service.js";
import {
  listConversations,
  listMessages,
  markConversationRead,
  sendMessage,
  startConversation,
  unreadMessageCount,
} from "../services/social/messages.service.js";
import {
  listNotifications,
  markNotificationsRead,
  unreadNotificationCount,
} from "../services/social/notifications.service.js";
import {
  addComment,
  createPost,
  deleteComment,
  deletePost,
  getFeed,
  getPost,
  likePost,
  listComments,
  listUserPosts,
  readAvatarImage,
  readPostImage,
  unlikePost,
} from "../services/social/posts.service.js";
import {
  getOwnProfile,
  getProfileByUsername,
  listBlockedMembers,
  removeOwnAvatar,
  searchMembers,
  setOwnAvatar,
  updateOwnProfile,
} from "../services/social/profiles.service.js";
import { lookupUsernameSchema, pageQuerySchema, uuidSchema } from "../services/social/validation.js";

// All social endpoints are server-to-server: only the Next.js app (which holds
// the internal secret) can call them, and it tells us WHO is acting through
// the `x-viewer-id` header, taken from the signed-in session. A browser can
// never set that header, and no endpoint accepts a user id for the actor in
// its body, query or path — so one member cannot act as another.
export const socialRouter = Router();
socialRouter.use(requireInternalSecret);

declare module "express-serve-static-core" {
  interface Request {
    viewerId?: string;
  }
}

socialRouter.use((req, res, next) => {
  const parsed = uuidSchema.safeParse(req.header("x-viewer-id"));
  if (!parsed.success) return res.status(401).json({ error: "Unauthorized." });
  req.viewerId = parsed.data;
  next();
});

function handler(fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch((err: unknown) => {
      if (err instanceof SocialError) {
        return res.status(err.status).json({ error: err.message, code: err.code });
      }
      if (err instanceof AuthError) {
        return res.status(err.status).json({ error: err.message });
      }
      if (err instanceof z.ZodError) {
        return res.status(400).json({ error: err.issues[0]?.message ?? "Invalid request." });
      }
      console.error("social route error:", err instanceof Error ? err.message : "unknown error");
      if (!res.headersSent) res.status(500).json({ error: "Something went wrong." });
      else next(err);
    });
  };
}

// Per-member rate limits, in the same fail-open style as the rest of the API.
function limit(name: string, max: number, windowSeconds: number): RequestHandler {
  return async (req, res, next) => {
    const result = await checkLimitFailOpen(`ratelimit:social:${name}:${req.viewerId}`, max, windowSeconds, `social:${name}`);
    if (!result.allowed) return sendRateLimitedResponse(res, result.retryAfterSeconds);
    next();
  };
}

const viewer = (req: Request) => req.viewerId!;
const username = (req: Request) => lookupUsernameSchema.parse(req.params.username);
const idParam = (req: Request, name = "id") => {
  const parsed = uuidSchema.safeParse(req.params[name]);
  if (!parsed.success) throw new SocialError("Not found.", 404, "not_found");
  return parsed.data;
};
const page = (req: Request) => pageQuerySchema.parse(req.query);

// --- Profiles ----------------------------------------------------------------

socialRouter.get("/me", handler(async (req, res) => res.json({ profile: await getOwnProfile(viewer(req)) })));

const profileSchema = z.object({
  username: z.string().max(100).optional(),
  displayName: z.string().max(200).optional(),
  bio: z.string().max(2000).optional(),
});

socialRouter.put(
  "/me/profile",
  limit("profile", 20, 3600),
  handler(async (req, res) => {
    const body = profileSchema.parse(req.body);
    res.json({ profile: await updateOwnProfile(viewer(req), body) });
  }),
);

const imageSchema = z.object({ imageBase64: z.string().min(1).max(8 * 1024 * 1024), mimeType: z.string().max(50) });

socialRouter.put(
  "/me/avatar",
  limit("avatar", 10, 3600),
  handler(async (req, res) => {
    const body = imageSchema.parse(req.body);
    res.json({ profile: await setOwnAvatar(viewer(req), body.imageBase64, body.mimeType) });
  }),
);

socialRouter.delete("/me/avatar", handler(async (req, res) => res.json({ profile: await removeOwnAvatar(viewer(req)) })));

socialRouter.get(
  "/search",
  limit("search", 60, 60),
  handler(async (req, res) => {
    const q = z.object({ q: z.string().max(60) }).parse(req.query).q;
    res.json({ users: await searchMembers(viewer(req), q, 20) });
  }),
);

socialRouter.get("/users/:username", handler(async (req, res) => res.json({ profile: await getProfileByUsername(viewer(req), username(req)) })));

socialRouter.get(
  "/users/:username/posts",
  handler(async (req, res) => {
    const { cursor, limit: size } = page(req);
    res.json(await listUserPosts(viewer(req), username(req), cursor, size));
  }),
);

socialRouter.get(
  "/users/:username/followers",
  handler(async (req, res) => {
    const { cursor, limit: size } = page(req);
    res.json(await listFollowers(viewer(req), username(req), cursor, size));
  }),
);

socialRouter.get(
  "/users/:username/following",
  handler(async (req, res) => {
    const { cursor, limit: size } = page(req);
    res.json(await listFollowing(viewer(req), username(req), cursor, size));
  }),
);

// --- Follows -----------------------------------------------------------------

socialRouter.post("/users/:username/follow", limit("follow", 60, 3600), handler(async (req, res) => res.json(await followMember(viewer(req), username(req)))));
socialRouter.delete("/users/:username/follow", limit("follow", 60, 3600), handler(async (req, res) => res.json(await unfollowMember(viewer(req), username(req)))));

// --- Posts, feed, likes, comments -------------------------------------------

socialRouter.get(
  "/feed",
  handler(async (req, res) => {
    const { cursor, limit: size } = page(req);
    res.json(await getFeed(viewer(req), cursor, size));
  }),
);

const createPostSchema = imageSchema.extend({ caption: z.string().max(5000).optional() });

socialRouter.post(
  "/posts",
  limit("post", 20, 3600),
  handler(async (req, res) => {
    const body = createPostSchema.parse(req.body);
    res.status(201).json({ post: await createPost(viewer(req), body) });
  }),
);

socialRouter.get("/posts/:id", handler(async (req, res) => res.json({ post: await getPost(viewer(req), idParam(req)) })));
socialRouter.delete("/posts/:id", handler(async (req, res) => {
  await deletePost(viewer(req), idParam(req));
  res.json({ deleted: true });
}));

socialRouter.post("/posts/:id/like", limit("like", 120, 60), handler(async (req, res) => res.json(await likePost(viewer(req), idParam(req)))));
socialRouter.delete("/posts/:id/like", limit("like", 120, 60), handler(async (req, res) => res.json(await unlikePost(viewer(req), idParam(req)))));

socialRouter.get(
  "/posts/:id/comments",
  handler(async (req, res) => {
    const { cursor, limit: size } = page(req);
    res.json(await listComments(viewer(req), idParam(req), cursor, Math.min(size, 20)));
  }),
);

socialRouter.post(
  "/posts/:id/comments",
  limit("comment", 30, 60),
  handler(async (req, res) => {
    const body = z.object({ content: z.string().max(5000) }).parse(req.body);
    res.status(201).json({ comment: await addComment(viewer(req), idParam(req), body.content) });
  }),
);

socialRouter.delete("/comments/:id", handler(async (req, res) => {
  await deleteComment(viewer(req), idParam(req));
  res.json({ deleted: true });
}));

// --- Media (authenticated; the bucket is never public) ----------------------

// Images are private to signed-in members and may be removed at any time (a
// post deleted, a member blocked or deleted), so browsers may keep them for an
// hour at most — long enough to be fast, short enough that a removal takes
// effect soon.
function sendImage(res: Response, image: { bytes: Buffer; mimeType: string }) {
  res.setHeader("Content-Type", image.mimeType);
  res.setHeader("Content-Length", String(image.bytes.length));
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
  res.setHeader("Cache-Control", "private, max-age=3600");
  res.status(200).end(image.bytes);
}

socialRouter.get("/media/posts/:id", handler(async (req, res) => sendImage(res, await readPostImage(viewer(req), idParam(req)))));
socialRouter.get("/media/avatars/:username", handler(async (req, res) => sendImage(res, await readAvatarImage(viewer(req), username(req)))));

// --- Messaging ---------------------------------------------------------------

socialRouter.get(
  "/conversations",
  handler(async (req, res) => {
    const { cursor, limit: size } = page(req);
    res.json(await listConversations(viewer(req), cursor, size));
  }),
);

socialRouter.post(
  "/conversations",
  limit("conversation", 30, 3600),
  handler(async (req, res) => {
    const body = z.object({ username: lookupUsernameSchema }).parse(req.body);
    res.status(201).json(await startConversation(viewer(req), body.username));
  }),
);

socialRouter.get(
  "/conversations/:id/messages",
  handler(async (req, res) => {
    const { cursor, limit: size } = page(req);
    res.json(await listMessages(viewer(req), idParam(req), cursor, size));
  }),
);

socialRouter.post(
  "/conversations/:id/messages",
  limit("message", 30, 60),
  handler(async (req, res) => {
    const body = z.object({ content: z.string().max(5000).optional(), postId: z.string().max(60).optional() }).parse(req.body);
    res.status(201).json({ message: await sendMessage(viewer(req), idParam(req), body) });
  }),
);

socialRouter.post("/conversations/:id/read", handler(async (req, res) => {
  await markConversationRead(viewer(req), idParam(req));
  res.json({ ok: true });
}));

// --- Notifications -----------------------------------------------------------

socialRouter.get(
  "/notifications",
  handler(async (req, res) => {
    const { cursor, limit: size } = page(req);
    res.json(await listNotifications(viewer(req), cursor, size));
  }),
);

socialRouter.get("/unread-counts", handler(async (req, res) => {
  await loadViewer(viewer(req), { needsUsername: false });
  const [notifications, messages] = await Promise.all([unreadNotificationCount(viewer(req)), unreadMessageCount(viewer(req))]);
  res.json({ notifications, messages });
}));

socialRouter.post("/notifications/read", handler(async (req, res) => {
  const body = z.object({ ids: z.array(uuidSchema).max(100).optional() }).parse(req.body ?? {});
  await markNotificationsRead(viewer(req), body.ids);
  res.json({ ok: true });
}));

// --- Safety: block and report ---------------------------------------------

socialRouter.post("/users/:username/block", limit("block", 30, 3600), handler(async (req, res) => {
  const me = await loadViewer(viewer(req));
  // Blocking is allowed even if the other member is no longer visible to the
  // viewer, but needs the account to exist.
  const target = await findBlockTarget(username(req));
  if (target === me.id) throw new AuthError("You can't block yourself.", 400);
  await blockUser(me.id, target);
  res.json({ blocked: true });
}));

socialRouter.get("/blocked", handler(async (req, res) => res.json({ users: await listBlockedMembers(viewer(req)) })));

socialRouter.delete("/users/:username/block", handler(async (req, res) => {
  const me = await loadViewer(viewer(req));
  const target = await findBlockTarget(username(req));
  await unblockUser(me.id, target);
  res.json({ blocked: false });
}));

async function findBlockTarget(name: string): Promise<string> {
  const [row] = await db.select({ id: users.id }).from(users).where(eq(users.username, name.toLowerCase())).limit(1);
  if (!row) throw new SocialError("That member wasn't found.", 404, "not_found");
  return row.id;
}

const reasonEnum = z.enum(["harassment", "sexual_inappropriate", "not_eligible", "fake_profile", "spam_scam", "threatening_unsafe", "other"]);
const reportSchema = z.object({ reason: reasonEnum, description: z.string().max(1000).nullable().optional() });

socialRouter.post("/users/:username/report", limit("report", 5, 3600), handler(async (req, res) => {
  const me = await loadViewer(viewer(req));
  const target = await findVisibleMemberByUsername(me.id, username(req));
  const body = reportSchema.parse(req.body);
  const report = await createReport({ reporterUserId: me.id, reportedUserId: target.id, reason: body.reason, description: body.description ?? null });
  res.status(201).json({ reported: true, reportId: report.id });
}));

socialRouter.post("/posts/:id/report", limit("report", 5, 3600), handler(async (req, res) => {
  const me = await loadViewer(viewer(req));
  const post = await getPostForReport(me.id, idParam(req));
  const body = reportSchema.parse(req.body);
  const report = await createReport({
    reporterUserId: me.id,
    reportedUserId: post.authorId,
    reason: body.reason,
    description: body.description ?? null,
    postId: post.id,
  });
  res.status(201).json({ reported: true, reportId: report.id });
}));

async function getPostForReport(viewerId: string, postId: string): Promise<{ id: string; authorId: string }> {
  // Reuses the visibility rule: you can only report a post you can see.
  await getPost(viewerId, postId);
  const [row] = await db.select({ id: posts.id, authorId: posts.authorId }).from(posts).where(eq(posts.id, postId)).limit(1);
  if (!row) throw new SocialError("That post isn't available.", 404, "not_found");
  return row;
}
