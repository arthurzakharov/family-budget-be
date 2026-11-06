import type { MiddlewareHandler } from "hono";
import { createMiddleware } from "hono/factory";
import type { Db } from "@/db/client";
import { ApiError } from "@/errors";
import { readSessionToken } from "@/lib/session-cookie";
import {
  canEdit,
  findSession,
  findWorkspaceUser,
  type CurrentUser,
  type Session,
} from "@/lib/sessions";
import type { AppEnv } from "@/types/app-env";

/** Env of routes behind `requireUser`: the logged-in user and their session. */
export type UserEnv = AppEnv & {
  Variables: AppEnv["Variables"] & {
    user: CurrentUser;
    session: Session;
  };
};

type RequireUserOptions = {
  /** Only the admin may pass. */
  admin?: boolean;
  /** Only users who may change records (not viewers) may pass. */
  edit?: boolean;
};

/**
 * Lets the request through only for a logged-in user (401 otherwise) who
 * passes `options` (403 otherwise); sets `c.var.user` and `c.var.session`.
 */
export function requireUser(
  db: Db,
  { admin = false, edit = false }: RequireUserOptions = {},
): MiddlewareHandler<UserEnv> {
  return createMiddleware<UserEnv>(async (c, next) => {
    const session = await findSession(db, readSessionToken(c));
    const user =
      session?.userId &&
      (await findWorkspaceUser(db, session.workspaceId, session.userId));
    if (!session || !user) throw new ApiError(401, "errors.unauthorized");
    if ((admin && user.role !== "admin") || (edit && !canEdit(user.role))) {
      throw new ApiError(403, "errors.forbidden");
    }
    c.set("user", user);
    c.set("session", session);
    await next();
  });
}
