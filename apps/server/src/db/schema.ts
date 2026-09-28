import { pgTable, uuid, text, boolean, timestamp, pgEnum, primaryKey } from "drizzle-orm/pg-core";

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

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  displayName: text("display_name").notNull(),

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
  isBanned: boolean("is_banned").notNull().default(false),

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
