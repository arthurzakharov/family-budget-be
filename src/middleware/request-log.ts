import type { MiddlewareHandler } from "hono";
import { createMiddleware } from "hono/factory";
import { getRequestLogFn } from "@/contexts/request";
import type { AppEnv } from "@/types/app-env";
import type { LogLevels } from "@/types/log";

/**
 * Determines the appropriate log severity level based on the HTTP response status code.
 *
 * - `5xx` status codes map to `'error'`
 * - `4xx` status codes map to `'warn'`
 * - All other status codes map to `'info'`
 */
function getLogLevelsByStatus(status: number): LogLevels {
  return status >= 500 ? "error" : status >= 400 ? "warn" : "info";
}

/**
 * Middleware that measures request duration and logs HTTP access details.
 * Logs key request metadata (HTTP method, path, response status, and duration in milliseconds)
 * using a request-bound log. Log severity is automatically inferred from the response status code.
 */
export function requestLog(): MiddlewareHandler<AppEnv> {
  return createMiddleware<AppEnv>(async (c, next) => {
    const start = performance.now();

    // Runs the rest of the chain; thrown errors are already turned into a
    // response by `onError`, so `c.res.status` is the final status.
    await next();

    const method = c.req.method;
    const path = c.req.path;
    const status = c.res.status;
    const durationMs = Math.round((performance.now() - start) * 100) / 100;
    const level = getLogLevelsByStatus(status);
    const logFn = getRequestLogFn(level);

    logFn({ method, path, status, durationMs }, "request completed");
  });
}
