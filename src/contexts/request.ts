import { AsyncLocalStorage } from "node:async_hooks";
import type { Log, LogFn, LogLevels } from "@/types/log";

export type RequestContext = {
  /** Child log with `requestId` already bound to every line. */
  log: Log;
  /** `id` of the incoming request; forwarded upstream as `X-Request-Id`. */
  requestId: string;
  /** Aborts when the client disconnects. */
  signal: AbortSignal;
};

const storage = new AsyncLocalStorage<RequestContext>();

/**
 * Runs `fn` with `context` available to everything it calls, across `await`s,
 * via the getters below.
 */
export function runWithRequestContext<T>(
  context: RequestContext,
  fn: () => T,
): T {
  return storage.run(context, fn);
}

/** Returns the current request's log. */
export function getRequestLog(): Log {
  return getStore().log;
}

/** Returns the log function for a specific severity level bound to the current request. */
export function getRequestLogFn(level: LogLevels): LogFn {
  const log = getStore().log;
  // Pino's methods rely on `this`, so bind before handing the function out.
  return log[level].bind(log);
}

/** Returns the current request's id. */
export function getRequestId(): string {
  return getStore().requestId;
}

/** Returns the signal that aborts when the current request's client disconnects. */
export function getRequestSignal(): AbortSignal {
  return getStore().signal;
}

/**
 * Every request runs inside a context (see the `requestContext` middleware),
 * so a missing one means the code is wired wrong.
 */
function getStore(): RequestContext {
  const store = storage.getStore();
  if (!store) {
    throw new Error("request context accessed outside of a request");
  }
  return store;
}
