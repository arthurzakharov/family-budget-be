import { z } from "zod";
import * as CustomSchemas from "@/lib/custom-schemas";

/**
 * Raw, unvalidated environment variables as provided by `process.env`.
 */
type RawEnv = Record<string, string | undefined>;

/** Local Postgres from `docker-compose.yml`; used when `DATABASE_URL` is unset outside production. */
const LOCAL_DATABASE_URL =
  "postgres://family_budget:family_budget@localhost:5432/family_budget";

/**
 * Schema defining and validating the application environment variables structure.
 * Maps environment key-value pairs to their respective custom Zod schemas.
 */
const envSchema = z
  .object({
    NODE_ENV: CustomSchemas.nodeEnv,
    PORT: CustomSchemas.port,
    LOG_LEVEL: CustomSchemas.logLevel,
    LOG_FORMAT: CustomSchemas.logFormat,
    ALLOWED_ORIGINS: CustomSchemas.urlOrigins,
    DATABASE_URL: CustomSchemas.optionalDatabaseUrl,
    /** Optional CoinGecko Demo API key for crypto prices (higher rate limits). */
    COINGECKO_API_KEY: CustomSchemas.optionalString,
    GIT_COMMIT_HASH: CustomSchemas.optionalString,
    GIT_COMMIT_MESSAGE: CustomSchemas.optionalString,
    GIT_COMMIT_AUTHOR: CustomSchemas.optionalString,
    GIT_COMMIT_DATE: CustomSchemas.optionalString,
  })
  .superRefine((env, ctx) => {
    /**
     * Cross-field refinement rule for production environments.
     * Ensures that `ALLOWED_ORIGINS` contains at least one valid origin and `DATABASE_URL` is set when running in production mode.
     * Skips validation for non-production environments (`development`, `test`).
     */
    if (env.NODE_ENV !== "production") return;

    if (env.ALLOWED_ORIGINS.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["ALLOWED_ORIGINS"],
        message: "required in production",
      });
    }

    if (!env.DATABASE_URL) {
      ctx.addIssue({
        code: "custom",
        path: ["DATABASE_URL"],
        message: "required in production",
      });
    }
  })
  /**
   * Falls back to the local Docker Postgres outside production
   * (production without `DATABASE_URL` is rejected above).
   */
  .transform((env) => ({
    ...env,
    DATABASE_URL: env.DATABASE_URL ?? LOCAL_DATABASE_URL,
  }));

/**
 * TypeScript type representing the fully parsed and validated application env config.
 */
export type Env = z.infer<typeof envSchema>;

/**
 * Parses and validates raw environment variables, throwing a formatted error if validation fails.
 */
export function parseEnv(source: RawEnv): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new Error(`Invalid env variables:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
