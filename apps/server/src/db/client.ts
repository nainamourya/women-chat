import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema.js";
import { env } from "../config/env.js";

const queryClient = postgres(env.DATABASE_URL);

export const db = drizzle(queryClient, { schema });
