import { zValidator } from "@hono/zod-validator";
import type { ValidationTargets } from "hono";
import type { z } from "zod";
import { ValidationError } from "@/errors";

/**
 * Validates a request part (`json`, `query`, `param`, ...) against a Zod schema.
 * On failure throws `ValidationError` with issue paths prefixed by the target
 * (e.g. `json.name`), which the error handler turns into a 400 response.
 * On success the parsed data is available via `c.req.valid(target)` and is
 * part of the RPC client types.
 */
export function validate<
  Target extends keyof ValidationTargets,
  Schema extends z.ZodType,
>(target: Target, schema: Schema) {
  return zValidator(target, schema, (result) => {
    if (!result.success) {
      throw new ValidationError(
        result.error.issues.map((issue) => ({
          path: [target, ...issue.path.map(String)].join("."),
          message: issue.message,
        })),
      );
    }
  });
}
