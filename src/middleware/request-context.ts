import type { MiddlewareHandler } from "hono";
import { createMiddleware } from "hono/factory";
import { runWithRequestContext } from "@/contexts/request";
import type { AppEnv } from "@/types/app-env";
import type { Log } from "@/types/log";

const REQUEST_ID_HEADER = "X-Request-Id";

/**
 * Resolves the request id, binds a child log to it and runs the rest of the
 * request inside the request context. Register it before any other middleware.
 */
export function requestContext(log: Log): MiddlewareHandler<AppEnv> {
  return createMiddleware<AppEnv>(async (c, next) => {
    const requestId = resolveRequestId(c.req.header(REQUEST_ID_HEADER));
    const requestLog = log.child({ requestId });
    c.set("requestId", requestId);
    c.set("log", requestLog);
    c.header(REQUEST_ID_HEADER, requestId);

    await runWithRequestContext(
      { log: requestLog, requestId, signal: c.req.raw.signal },
      next,
    );
  });
}

/** Reuses a well-formed incoming id (same rules as Hono's `requestId()`), otherwise generates one. */
function resolveRequestId(incoming: string | undefined): string {
  return incoming && incoming.length <= 255 && /^[\w\-=]+$/.test(incoming)
    ? incoming
    : crypto.randomUUID();
}
