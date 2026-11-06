/**
 * Reusable Zod schemas and custom validation rules
 * for application configuration and environment variables.
 */
import { z } from "zod";

/**
 * Validates the runtime application environment.
 * Restricts values to `'development'`, `'test'`, or `'production'`.
 * Defaults to `'development'` if omitted.
 */
export const nodeEnv = z
  .enum(["development", "test", "production"])
  .default("development");

/**
 * Validates and parses the application network port number.
 * Coerces string inputs to numbers and ensures an integer within the valid TCP port range (1–65535).
 * Defaults to `3000` if omitted.
 */
export const port = z.coerce.number().int().min(1).max(65535).default(3000);

/**
 * Validates the logging severity level.
 * Restricts values to standard log levels (`'fatal'`, `'error'`, `'warn'`, `'info'`, `'debug'`, `'trace'`, or `'silent'`).
 * Defaults to `'info'` if omitted.
 */
export const logLevel = z
  .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
  .default("info");

/**
 * Validates the application log output format.
 * Restricts values to `'json'` (structured output) or `'pretty'` (human-readable formatting).
 * Defaults to `'json'` if omitted.
 */
export const logFormat = z.enum(["json", "pretty"]).default("json");

/**
 * Converts empty (or whitespace-only) strings to undefined.
 * Accepts strings or undefined. Non-empty strings are preserved as-is.
 * Any other types (number, boolean, null, etc.) will throw a ZodError.
 */
export const optionalString = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim() === "" ? undefined : value,
  z.string().optional(),
);

/**
 * Validates an optional Postgres connection URL (`postgres://` or `postgresql://`).
 * Empty (or whitespace-only) strings are treated as unset.
 */
export const optionalDatabaseUrl = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim() === "" ? undefined : value,
  z.url({ protocol: /^postgres(ql)?$/ }).optional(),
);

/**
 * Parses a comma-separated string of URLs into an array of normalized URL origins.
 *
 * Execution flow:
 * 1. Accepts a string (defaults to `""` if undefined).
 * 2. Splits the string by commas, trims whitespace, and filters out empty values.
 * 3. Validates each element against standard URL formatting (`z.url()`).
 * 4. Extracts and normalizes the scheme + authority (`origin`) from each URL using the `URL` API.
 */
export const urlOrigins = z
  .string()
  .default("")
  .transform((value) =>
    value
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  )
  .pipe(z.array(z.url()))
  .transform((urls) => urls.map((url) => new URL(url).origin));
