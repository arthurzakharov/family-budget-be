import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { Db } from "@/db/client";
import * as schema from "@/db/schema";

/** Same folder `runMigrations` applies (not imported, so the Bun SQL driver stays unloaded). */
const MIGRATIONS_FOLDER = "drizzle";

/** An in-memory Postgres with all migrations applied. */
export async function createTestDb(): Promise<Db> {
  const db = drizzle(new PGlite(), { schema, casing: "snake_case" });
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return db;
}
