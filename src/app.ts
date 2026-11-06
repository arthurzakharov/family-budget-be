import { Hono } from "hono";
import { cors } from "hono/cors";
import { csrf } from "hono/csrf";
import { secureHeaders } from "hono/secure-headers";
import type { Db } from "@/db/client";
import { today as localToday } from "@/lib/dates";
import type { CookieOptions } from "@/lib/session-cookie";
import type { CommitInfo } from "@/types/commit-info";
import type { AppEnv } from "@/types/app-env";
import type { Log } from "@/types/log";
import { errorHandler } from "@/middleware/error-handler";
import { notFound } from "@/middleware/not-found";
import { requestContext } from "@/middleware/request-context";
import { requestLog } from "@/middleware/request-log";
import { createAuthRoutes } from "@/routes/auth";
import { createCryptoRoutes } from "@/routes/crypto";
import { createDepositRoutes } from "@/routes/deposit";
import { createExpenseRoutes } from "@/routes/expenses";
import { createGroupRoutes } from "@/routes/groups";
import { createHealthRoutes } from "@/routes/health";
import { createUserRoutes } from "@/routes/users";

/** Dependencies injected into the app. */
type CreateAppParams = {
  /** Root log; each request gets a child bound to its request id. */
  log: Log;
  /** Shown by the health endpoint; `null` when unavailable. */
  commitInfo: CommitInfo | null;
  /** CORS allowed origins (Hono `cors({ origin })`); they may send the session cookie. */
  origin: string[];
  db: Db;
  /** How the session cookie is sent; `secure` outside local development. */
  cookie: CookieOptions;
  /** Today as `YYYY-MM-DD`; defaults to the server's local date. */
  today?: (() => string) | undefined;
};

/** Builds the Hono app: middleware, error handling and routes. */
export function createApp({
  log,
  commitInfo,
  origin,
  db,
  cookie,
  today = localToday,
}: CreateAppParams) {
  const app = new Hono<AppEnv>();

  // Must run first: assigns a request id (X-Request-Id) and a request-bound
  // child log, available via `c` and the async request context.
  app.use(requestContext(log));
  // Sets security headers (HSTS, X-Frame-Options, X-Content-Type-Options, ...).
  app.use(secureHeaders());
  // Allows cross-origin calls from `origin` only; exposes X-Request-Id to browsers.
  // Credentials: the frontend sends the session cookie (`credentials: "include"`).
  app.use(cors({ origin, credentials: true, exposeHeaders: ["X-Request-Id"] }));
  // Rejects form posts from other origins, which a cookie session would
  // otherwise accept (JSON requests from other origins already need CORS).
  app.use(csrf({ origin }));
  // Logs every completed request; level depends on response status.
  app.use(requestLog());
  // JSON 404 for unknown routes.
  app.notFound(notFound());
  // Maps thrown errors to JSON error responses.
  app.onError(errorHandler());

  return app
    .route("/", createHealthRoutes(commitInfo))
    .route("/", createAuthRoutes(db, cookie))
    .route("/", createUserRoutes(db))
    .route("/", createGroupRoutes(db))
    .route("/", createDepositRoutes({ db, today }))
    .route("/", createCryptoRoutes(db))
    .route("/", createExpenseRoutes(db));
}

/** App type for the typed RPC client (`hc<AppType>`). */
export type AppType = ReturnType<typeof createApp>;
export type * from "@/types/responses";
