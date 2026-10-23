import { z } from "zod";
import { AuthError } from "../auth.service.js";

// Shared input rules for the social features. Everything user-supplied is
// validated here (and again by database constraints where one exists) before
// it reaches a query.

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 30;

// Names that would be confusing or could impersonate the platform or its
// routes. Compared against the lowercase username.
const RESERVED_USERNAMES = new Set([
  "admin", "administrator", "root", "support", "help", "security", "moderator", "mod", "staff", "team",
  "giigirl", "giigirls", "official", "system", "api", "me", "null", "undefined", "anonymous",
  "login", "logout", "signup", "register", "profile", "settings", "feed", "discover", "search",
  "messages", "inbox", "notifications", "post", "posts", "match", "terms", "privacy", "guidelines",
]);

// Lowercase letters, digits, "_" and "."; no leading/trailing "." and no "..".
// Matches the users_username_format check constraint.
const USERNAME_PATTERN = /^[a-z0-9_][a-z0-9_.]{1,28}[a-z0-9_]$/;

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(USERNAME_MIN, `Usernames need at least ${USERNAME_MIN} characters.`)
  .max(USERNAME_MAX, `Usernames can be at most ${USERNAME_MAX} characters.`)
  .refine((value) => USERNAME_PATTERN.test(value) && !value.includes(".."), {
    message: "Use only letters, numbers, underscores and single periods; don't start or end with a period.",
  })
  .refine((value) => !RESERVED_USERNAMES.has(value), { message: "That username isn't available." });

// Same shape as an existing username, but without the reserved-name rule, for
// looking someone up (a lookup of "admin" should simply find nobody).
export const lookupUsernameSchema = z.string().trim().toLowerCase().min(1).max(USERNAME_MAX);

// Control characters other than newline/tab are never legitimate in profile
// text, captions or messages; reject them rather than store them.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

function plainText(max: number, label: string, { min = 0, allowNewlines = true } = {}) {
  return z
    .string()
    .transform((value) => value.replace(/\r\n/g, "\n").trim())
    .refine((value) => !CONTROL_CHARS.test(value), { message: `${label} contains characters that aren't allowed.` })
    .refine((value) => allowNewlines || !value.includes("\n"), { message: `${label} must be a single line.` })
    .refine((value) => value.length >= min, { message: min === 1 ? `${label} can't be empty.` : `${label} is too short.` })
    .refine((value) => value.length <= max, { message: `${label} must be ${max} characters or fewer.` });
}

export const displayNameSchema = plainText(50, "Display name", { min: 2, allowNewlines: false });
export const bioSchema = plainText(500, "Bio");
export const captionSchema = plainText(2200, "Caption");
export const commentSchema = plainText(1000, "Comment", { min: 1 });
export const messageSchema = plainText(2000, "Message", { min: 1 });

export const uuidSchema = z.string().uuid();

// ---------------------------------------------------------------------------
// Cursor pagination. Cursors are opaque to clients; internally they carry the
// last row's (timestamp, id) so paging is stable even when rows share a
// timestamp, and never skips or repeats an item when new rows arrive.
// ---------------------------------------------------------------------------

export const DEFAULT_PAGE_SIZE = 12;
export const MAX_PAGE_SIZE = 30;

// `t` is the row's timestamp as text with MICROSECOND precision. PostgreSQL
// stores microseconds but a JavaScript Date only holds milliseconds, so a Date
// based cursor would repeat or skip rows created in the same millisecond. The
// timestamp is therefore read from the database as text (see `tsText`) and
// handed back to it unchanged.
export type Cursor = { t: string; id: string };

const TS_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/;

export function encodeCursor(ts: string, id: string): string {
  return Buffer.from(JSON.stringify({ t: ts, id })).toString("base64url");
}

export function decodeCursor(raw: string | undefined): Cursor | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Partial<Cursor>;
    if (typeof parsed.t === "string" && TS_PATTERN.test(parsed.t) && typeof parsed.id === "string" && uuidSchema.safeParse(parsed.id).success) {
      return { t: parsed.t, id: parsed.id };
    }
  } catch {
    // fall through
  }
  throw new AuthError("Invalid cursor.", 400);
}

export const pageQuerySchema = z.object({
  cursor: z.string().max(300).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});

export type Page<T> = { items: T[]; nextCursor: string | null };

// Run a "limit + 1" query: the extra row only tells us whether another page
// exists. Rows must carry `ts` (the timestamp as text, via `tsText`) and `id`.
export function toPage<T extends { ts: string; id: string }>(rows: T[], limit: number): Page<T> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  return { items, nextCursor: hasMore && last ? encodeCursor(last.ts, last.id) : null };
}
