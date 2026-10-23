import { pgTable, uuid, text, boolean, timestamp, pgEnum, primaryKey, index, unique, uniqueIndex, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// Vendor-agnostic verification status. MVP sets this via a manual/stub flow only.
// A real third-party provider (Persona, Veriff, etc.) will later populate the same
// column via webhook — no schema change required.
export const verificationStatusEnum = pgEnum("verification_status", [
  "unverified",
  "pending",
  "verified",
  "rejected",
  // Distinct from "rejected": the applicant is invited to submit a new
  // video (e.g. unclear footage), rather than a final decision.
  "resubmission_required",
]);

export const userRoleEnum = pgEnum("user_role", ["user", "admin"]);

// Replaces the old boolean `isBanned` flag with a tri-state so a temporary
// suspension (with an optional expiry) can be distinguished from a
// permanent ban, per the moderation flow in reports.service.ts.
//
// "deleted" is the tombstone state set by accountDeletion.service.ts, which
// anonymizes the row in place rather than removing it (moderation records
// reference it). Added by migration 0009 — a non-destructive ADD VALUE.
export const accountStatusEnum = pgEnum("account_status", ["active", "suspended", "banned", "deleted"]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  // Nullable: accounts created via Google sign-in have no password. Never
  // set/read for such accounts — credentials login rejects them explicitly.
  passwordHash: text("password_hash"),
  displayName: text("display_name").notNull(),

  // Public handle for the social features. Always stored lowercase (the check
  // constraint below enforces it), so the plain unique constraint is
  // case-insensitive. Null until the member chooses one; social actions
  // require it. Cleared when an account is deleted so the handle is freed.
  username: text("username").unique(),
  // Object key (not a URL) of the profile photo in private storage — served
  // only through the authenticated media route. Null = no photo.
  avatarKey: text("avatar_key"),

  // Google account identifier (OIDC `sub`), used only to find/link an
  // existing account by email and to recognize repeat Google sign-ins. Never
  // used as an authentication secret. No Google tokens are stored.
  googleId: text("google_id").unique(),

  // 18+ self-attestation captured at signup. Not a substitute for real age verification.
  ageConfirmed18: boolean("age_confirmed_18").notNull().default(false),

  // Eligibility verification status/provenance. MVP only ever writes "unverified" or a
  // stub "pending"/"verified" via the manual test flow (never real ID/selfie data).
  verificationStatus: verificationStatusEnum("verification_status").notNull().default("unverified"),
  // Records how the status was reached, e.g. "manual_stub" now, a vendor name later.
  // Intentionally never stores raw ID images or selfie files — only an opaque reference.
  verificationMethod: text("verification_method"),
  verificationRef: text("verification_ref"),

  role: userRoleEnum("role").notNull().default("user"),
  accountStatus: accountStatusEnum("account_status").notNull().default("active"),
  // Only meaningful when accountStatus === "suspended". Null means an
  // indefinite suspension (admin must manually reactivate).
  suspendedUntil: timestamp("suspended_until", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
},
(table) => [
  // Lowercase letters, digits, "_" and "." only, 3-30 chars, no leading,
  // trailing or doubled "." — mirrored by the validation in
  // services/social/validation.ts so users get a friendly message first.
  check(
    "users_username_format",
    sql`${table.username} is null or (${table.username} ~ '^[a-z0-9_]([a-z0-9_.]{1,28})[a-z0-9_]$' and ${table.username} !~ '[.][.]')`,
  ),
]);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

// One-to-one with users. Private by design — never exposed via any public/
// unauthenticated route, and there is no other-user lookup endpoint. Kept
// separate from `users` so auth data and profile data can evolve independently.
export const userProfiles = pgTable("user_profiles", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  bio: text("bio"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type UserProfile = typeof userProfiles.$inferSelect;
export type NewUserProfile = typeof userProfiles.$inferInsert;

// Fixed catalog of selectable interests, managed server-side (seeded), not
// user-created.
export const interests = pgTable("interests", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Interest = typeof interests.$inferSelect;

// Join table for the user's selected interests (many-to-many).
export const userInterests = pgTable(
  "user_interests",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    interestId: uuid("interest_id")
      .notNull()
      .references(() => interests.id, { onDelete: "cascade" }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.interestId] })],
);

export const matchStatusEnum = pgEnum("match_status", ["active", "ended"]);

// A single 1:1 matchmaking session between two users. The live matchmaking
// queue itself lives in Redis (see matchmaking.service.ts) — this table is
// only the durable record of a match once two users are actually paired, and
// is the source of truth for "is this user already in an active match".
export const matches = pgTable(
  "matches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userAId: uuid("user_a_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    userBId: uuid("user_b_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: matchStatusEnum("status").notNull().default("active"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  // Supports findActiveMatch()'s `WHERE status = 'active' AND (user_a_id = $1
  // OR user_b_id = $1)` — hit on every matchmaking join and every 4s status
  // poll while a user waits (see matchmaking.service.ts). Two indexes rather
  // than one composite, so Postgres can BitmapOr across them for the OR
  // condition — same pattern already used for blocks' blocker/blocked lookup.
  (table) => [
    index("matches_user_a_id_status_idx").on(table.userAId, table.status),
    index("matches_user_b_id_status_idx").on(table.userBId, table.status),
  ],
);

export type Match = typeof matches.$inferSelect;

// Chat messages for an active (or previously active) match. Intentionally
// stores only the sender's id, not any denormalized profile/display data —
// readers join against `users`/`userProfiles` if a display name is ever
// needed, so nothing stale or sensitive is duplicated into each row.
export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    matchId: uuid("match_id")
      .notNull()
      .references(() => matches.id, { onDelete: "cascade" }),
    senderId: uuid("sender_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    content: text("content").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("messages_match_id_created_at_idx").on(table.matchId, table.createdAt)],
);

export type ChatMessage = typeof messages.$inferSelect;

export const reportReasonEnum = pgEnum("report_reason", [
  "harassment",
  "sexual_inappropriate",
  "not_eligible",
  "fake_profile",
  "spam_scam",
  "threatening_unsafe",
  "other",
]);

export const reportStatusEnum = pgEnum("report_status", [
  "pending",
  "under_review",
  "resolved",
  "dismissed",
]);

// The moderation outcome recorded on a report once an admin acts on it.
// "none" until reviewed; does not itself change the reported user's
// accountStatus — admins apply that separately via the same PATCH action
// (see reports.service.ts), so this column stays an audit trail of what
// was decided even if the account is later reactivated.
export const reportActionEnum = pgEnum("report_action", ["none", "warn", "suspend", "ban"]);

// User-submitted safety reports against another user, reviewed by an admin.
// A report is only an allegation until reviewed — creating one never changes
// the reported user's account status by itself.
export const reports = pgTable(
  "reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reporterUserId: uuid("reporter_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    reportedUserId: uuid("reported_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // The match this report was filed from, if any — gives admins chat
    // context during review. Never cascaded: a report must outlive the
    // match row it references.
    matchId: uuid("match_id").references(() => matches.id),
    // The post this report is about, if any. SET NULL (not cascade) so the
    // report survives the author deleting the post.
    postId: uuid("post_id").references(() => posts.id, { onDelete: "set null" }),

    reason: reportReasonEnum("reason").notNull(),
    description: text("description"),

    // Relative filename within the server's local evidence directory, e.g.
    // "a1b2c3.jpg" — never a public URL. See reports.service.ts for the
    // retention/access-control notes.
    evidencePath: text("evidence_path"),
    evidenceMimeType: text("evidence_mime_type"),

    status: reportStatusEnum("status").notNull().default("pending"),
    adminAction: reportActionEnum("admin_action").notNull().default("none"),
    adminNote: text("admin_note"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewedBy: uuid("reviewed_by").references(() => users.id),
  },
  (table) => [
    index("reports_status_idx").on(table.status),
    index("reports_reported_user_id_idx").on(table.reportedUserId),
    index("reports_created_at_idx").on(table.createdAt),
  ],
);

export type Report = typeof reports.$inferSelect;
export type NewReport = typeof reports.$inferInsert;

// One-directional block record. Matchmaking exclusion is applied
// bidirectionally (see matchmaking.service.ts) by checking both columns,
// regardless of which user initiated the block.
export const blocks = pgTable(
  "blocks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    blockerUserId: uuid("blocker_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    blockedUserId: uuid("blocked_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("blocks_blocker_user_id_idx").on(table.blockerUserId),
    index("blocks_blocked_user_id_idx").on(table.blockedUserId),
    unique("blocks_blocker_blocked_unique").on(table.blockerUserId, table.blockedUserId),
  ],
);

export type Block = typeof blocks.$inferSelect;

// Per-submission record for the introduction-video verification flow.
// `users.verificationStatus` remains the single source of truth read by the
// rest of the app for access control (matchmaking/chat/calls) — this table
// adds what that single column can't: submission history, minimal review
// metadata (reviewer, decision, timestamp), and video lifecycle/deletion
// tracking. Never stores the video itself — only an opaque storage key,
// matching the existing report-evidence pattern (schema.ts `reports` table).
export const videoVerificationStatusEnum = pgEnum("video_verification_status", [
  "pending_review",
  "approved",
  "rejected",
  "resubmission_required",
]);

// Neutral, predefined reasons only — deliberately no free-text field here,
// so no subjective/sensitive notes (or anything resembling an appearance/
// gender/voice judgement) can ever be recorded against a submission.
export const videoRejectionReasonEnum = pgEnum("video_rejection_reason", [
  "video_unclear_or_incomplete",
  "duration_or_format_invalid",
  "does_not_meet_guidelines",
  "other",
]);

export const verificationSubmissions = pgTable(
  "verification_submissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    status: videoVerificationStatusEnum("status").notNull().default("pending_review"),

    // Opaque server-generated filename within the private video directory —
    // never a public URL, never client-supplied. Set to NULL once the video
    // is confirmed deleted (see services/videoVerification.service.ts).
    videoStorageKey: text("video_storage_key"),
    videoDeletedAt: timestamp("video_deleted_at", { withTimezone: true }),
    // True while a review decision has been made but video deletion has not
    // yet been confirmed — see the service for why "approved" specifically
    // withholds granting access until this clears.
    videoDeletionPending: boolean("video_deletion_pending").notNull().default(false),
    // The decision an admin recorded while deletion was still pending —
    // applied to `users.verificationStatus` only once deletion succeeds.
    pendingDecision: videoVerificationStatusEnum("pending_decision"),

    rejectionReason: videoRejectionReasonEnum("rejection_reason"),
    reviewedBy: uuid("reviewed_by").references(() => users.id),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("verification_submissions_user_id_idx").on(table.userId),
    index("verification_submissions_status_idx").on(table.status),
    // Prevents a second concurrent submission while one is already awaiting
    // review — enforced at the database level (not just application logic)
    // so a race between two near-simultaneous submit requests can't create
    // two "pending_review" rows for the same user.
    uniqueIndex("verification_submissions_one_pending_per_user")
      .on(table.userId)
      .where(sql`${table.status} = 'pending_review'`),
  ],
);

export type VerificationSubmission = typeof verificationSubmissions.$inferSelect;
export type NewVerificationSubmission = typeof verificationSubmissions.$inferInsert;

// ---------------------------------------------------------------------------
// Social features: follows, posts, likes, comments, direct messages and
// notifications. Every table below keys off `users.id` and cascades on user
// removal; the soft "deleted" account state is handled in
// services/accountDeletion.service.ts.
// ---------------------------------------------------------------------------

// A directed follow edge: `followerId` follows `followeeId`. The composite
// primary key is the uniqueness guarantee (no duplicate follows) and the
// check constraint is the no-self-follow guarantee, both enforced by the
// database regardless of what the application does.
export const follows = pgTable(
  "follows",
  {
    followerId: uuid("follower_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    followeeId: uuid("followee_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.followerId, table.followeeId] }),
    // "Who follows X" (followers list, follower count) and the mutual check.
    index("follows_followee_created_idx").on(table.followeeId, table.createdAt, table.followerId),
    check("follows_no_self_follow", sql`${table.followerId} <> ${table.followeeId}`),
  ],
);

export type Follow = typeof follows.$inferSelect;

export const posts = pgTable(
  "posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    caption: text("caption").notNull().default(""),
    // Object key in private storage (never a URL, never client-supplied).
    imageKey: text("image_key").notNull(),
    imageMimeType: text("image_mime_type").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Profile grids and the feed both page by (created_at desc, id desc).
    index("posts_author_created_idx").on(table.authorId, table.createdAt, table.id),
    check("posts_caption_length", sql`char_length(${table.caption}) <= 2200`),
  ],
);

export type Post = typeof posts.$inferSelect;

export const postLikes = pgTable(
  "post_likes",
  {
    postId: uuid("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // The primary key makes a duplicate like impossible at the database level.
  (table) => [primaryKey({ columns: [table.postId, table.userId] }), index("post_likes_user_idx").on(table.userId)],
);

export const comments = pgTable(
  "comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    postId: uuid("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("comments_post_created_idx").on(table.postId, table.createdAt, table.id),
    index("comments_author_idx").on(table.authorId),
    check("comments_content_length", sql`char_length(btrim(${table.content})) between 1 and 1000`),
  ],
);

export type Comment = typeof comments.$inferSelect;

// A private conversation between exactly two members. The pair is stored in a
// canonical order (user_a_id < user_b_id) so one pair can only ever have one
// row; the unique constraint and the ordering check are both in the database.
// Whether the two may currently exchange messages is NOT stored — it is
// re-derived from `follows` and `blocks` on every send (see
// services/social/messages.service.ts), so an old conversation can never
// outlive the relationship that allowed it.
export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userAId: uuid("user_a_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    userBId: uuid("user_b_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull().defaultNow(),
    // Read markers per participant; unread = messages from the other user
    // newer than the participant's marker.
    userALastReadAt: timestamp("user_a_last_read_at", { withTimezone: true }),
    userBLastReadAt: timestamp("user_b_last_read_at", { withTimezone: true }),
  },
  (table) => [
    unique("conversations_pair_unique").on(table.userAId, table.userBId),
    index("conversations_user_a_last_idx").on(table.userAId, table.lastMessageAt),
    index("conversations_user_b_last_idx").on(table.userBId, table.lastMessageAt),
    check("conversations_pair_order", sql`${table.userAId} < ${table.userBId}`),
  ],
);

export type Conversation = typeof conversations.$inferSelect;

export const directMessages = pgTable(
  "direct_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    senderId: uuid("sender_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // May be empty only when the message shares a post.
    content: text("content").notNull().default(""),
    // A post shared into the conversation. SET NULL so deleting the post does
    // not delete the conversation history.
    postId: uuid("post_id").references(() => posts.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("direct_messages_conversation_created_idx").on(table.conversationId, table.createdAt, table.id),
    check("direct_messages_content_length", sql`char_length(${table.content}) <= 2000`),
  ],
);

export type DirectMessage = typeof directMessages.$inferSelect;

export const notificationTypeEnum = pgEnum("notification_type", ["follow", "like", "comment", "message"]);

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Who receives it, and who caused it.
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: notificationTypeEnum("type").notNull(),
    postId: uuid("post_id").references(() => posts.id, { onDelete: "cascade" }),
    commentId: uuid("comment_id").references(() => comments.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id").references(() => conversations.id, { onDelete: "cascade" }),
    // Deterministic per event ("like:<actor>:<post>", "comment:<id>",
    // "follow:<actor>", "message:<conversation>") so a retried request cannot
    // create a duplicate: the unique index below turns it into a no-op (or,
    // for messages, a refresh of the existing row).
    dedupeKey: text("dedupe_key").notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("notifications_user_dedupe_unique").on(table.userId, table.dedupeKey),
    index("notifications_user_created_idx").on(table.userId, table.createdAt, table.id),
    index("notifications_user_unread_idx").on(table.userId).where(sql`${table.readAt} is null`),
  ],
);

export type Notification = typeof notifications.$inferSelect;
