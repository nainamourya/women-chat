import { and, eq, gt, lt, or, sql, type AnyColumn, type SQL } from "drizzle-orm";
import type { Cursor } from "./validation.js";

// A timestamp column as ISO text with microsecond precision, for use as a
// pagination cursor (see the note on Cursor in validation.ts).
export const tsText = (column: AnyColumn): SQL<string> =>
  sql<string>`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

const stamp = (cursor: Cursor): SQL => sql`${cursor.t}::timestamptz`;

// Rows strictly after `cursor` in descending (newest first) order.
export function olderThan(column: AnyColumn, idColumn: AnyColumn, cursor: Cursor | null): SQL | undefined {
  if (!cursor) return undefined;
  return or(sql`${column} < ${stamp(cursor)}`, and(sql`${column} = ${stamp(cursor)}`, lt(idColumn, cursor.id)));
}

// Rows strictly after `cursor` in ascending (oldest first) order.
export function newerThan(column: AnyColumn, idColumn: AnyColumn, cursor: Cursor | null): SQL | undefined {
  if (!cursor) return undefined;
  return or(sql`${column} > ${stamp(cursor)}`, and(sql`${column} = ${stamp(cursor)}`, gt(idColumn, cursor.id)));
}

export { eq };
