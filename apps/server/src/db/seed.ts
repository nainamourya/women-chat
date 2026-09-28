import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { env } from "../config/env.js";
import { interests } from "./schema.js";

// Fixed starter catalog for the interests picker. Safe to re-run — existing
// names are left untouched.
const DEFAULT_INTERESTS = [
  "Books & Reading",
  "Movies & TV",
  "Music",
  "Travel",
  "Food & Cooking",
  "Fitness & Wellness",
  "Yoga & Meditation",
  "Art & Design",
  "Photography",
  "Gaming",
  "Tech & Gadgets",
  "Fashion & Beauty",
  "Nature & Outdoors",
  "Pets & Animals",
  "Career & Business",
  "Spirituality",
  "Sports",
  "Writing",
  "Volunteering",
  "Mental Health",
];

async function main() {
  const seedClient = postgres(env.DATABASE_URL, { max: 1 });
  const db = drizzle(seedClient);

  console.log("Seeding interests catalog...");
  await db
    .insert(interests)
    .values(DEFAULT_INTERESTS.map((name) => ({ name })))
    .onConflictDoNothing();
  console.log("Seed complete.");

  await seedClient.end();
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
