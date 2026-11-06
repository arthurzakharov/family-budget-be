import { defineConfig } from "drizzle-kit";

/** drizzle-kit config: generates SQL migrations in `drizzle/` from `src/db/schema.ts`. */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  casing: "snake_case",
});
