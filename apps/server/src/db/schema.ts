import { pgTable, uuid, text, boolean, timestamp, pgEnum, primaryKey, index, unique } from "drizzle-orm/pg-core";

// Vendor-agnostic verification status. MVP sets this via a manual/stub flow only.
// A real third-party provider (Persona, Veriff, etc.) will later populate the same
// column via webhook — no schema change required.
export const verificationStatusEnum = pgEnum("verification_status", [
  "unverified",
  "pending",
  "verified",
  "rejected",
]);

export const userRoleEnum = pgEnum("user_role", ["user", "admin"]);

// Replaces the old boolean `isBanned` flag with a tri-state so a temporary
// suspension (with an optional expiry) can be distinguished from a
// permanent ban, per the moderation flow in reports.service.ts.
export const accountStatusEnum = pgEnum("account_status", ["active", "suspended", "banned"]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  // Nullable: accounts created via Google sign-in have no password. Never
  // set/read for such accounts — credentials login rejects them explicitly.
  passwordHash: text("password_hash"),
  displayName: text("display_name").notNull(),

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
});

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
export const matches = pgTable("matches", {
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
});

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
