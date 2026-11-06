import { Hono, type Context } from "hono";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import { users, workspaces } from "@/db/schema";
import { ApiError } from "@/errors";
import { requireUser } from "@/middleware/auth";
import { validate } from "@/middleware/validate";
import * as Schemas from "@/lib/schemas";
import {
  clearSessionCookie,
  readSessionToken,
  writeSessionCookie,
  type CookieOptions,
} from "@/lib/session-cookie";
import {
  createSession,
  deleteSession,
  findSession,
  listWorkspaceUsers,
  setSessionUser,
  toPublicUser,
  type Session,
} from "@/lib/sessions";
import type { AppEnv } from "@/types/app-env";
import type { AuthStatus } from "@/types/responses";

const signupSchema = z.object({
  /** Unlocks the workspace (step 1 of logging in). */
  email: Schemas.email,
  password: Schemas.password,
  /** The admin's name and own password (step 2). */
  name: Schemas.name,
  userPassword: Schemas.password,
});

const credentials = { error: "errors.invalidCredentials" };

const loginSchema = z.object({
  email: z.string(credentials).transform((value) => value.toLowerCase()),
  password: z.string(credentials),
});

const userLoginSchema = z.object({
  userId: z.string(credentials),
  password: z.string(credentials),
});

const passwordSchema = z.object({
  current: z.string({ error: "errors.wrongPassword" }),
  next: Schemas.password,
});

/**
 * Logging in happens in two steps: unlock the workspace (`/auth/login`), then
 * pick a user and enter their password (`/auth/user-login`). The session lives
 * in an HttpOnly cookie.
 */
export function createAuthRoutes(db: Db, cookie: CookieOptions) {
  async function statusOf(session: Session | null): Promise<AuthStatus> {
    if (!session) return { stage: "none" };
    const all = await listWorkspaceUsers(db, session.workspaceId);
    const user = all.find((u) => u.id === session.userId);
    if (user) return { stage: "user", user: toPublicUser(user) };
    return {
      stage: "workspace",
      users: all.map(({ id, name }) => ({ id, name })),
    };
  }

  async function requireSession(c: Context): Promise<Session> {
    const session = await findSession(db, readSessionToken(c));
    if (!session) throw new ApiError(401, "errors.unauthorized");
    return session;
  }

  return (
    new Hono<AppEnv>()
      .get("/auth/status", async (c) =>
        c.json<AuthStatus>(
          await statusOf(await findSession(db, readSessionToken(c))),
        ),
      )
      // Creates a new workspace and its admin, and logs the admin in.
      .post("/auth/signup", validate("json", signupSchema), async (c) => {
        const body = c.req.valid("json");
        const [taken] = await db
          .select({ id: workspaces.id })
          .from(workspaces)
          .where(eq(workspaces.email, body.email));
        if (taken) throw new ApiError(409, "errors.emailTaken");

        const passwordHash = await Bun.password.hash(body.password);
        const userPasswordHash = await Bun.password.hash(body.userPassword);
        const admin = await db.transaction(async (tx) => {
          const [workspace] = await tx
            .insert(workspaces)
            .values({ email: body.email, passwordHash })
            .returning({ id: workspaces.id });
          // The admin stands apart and never belongs to a group.
          const [created] = await tx
            .insert(users)
            .values({
              workspaceId: workspace!.id,
              name: body.name,
              role: "admin",
              passwordHash: userPasswordHash,
            })
            .returning({
              id: users.id,
              workspaceId: users.workspaceId,
              name: users.name,
              role: users.role,
            });
          return created!;
        });
        const session = await createSession(db, {
          workspaceId: admin.workspaceId,
          userId: admin.id,
        });
        writeSessionCookie(c, session.token, cookie);
        return c.json<AuthStatus>({
          stage: "user",
          user: toPublicUser({ ...admin, groupIds: [] }),
        });
      })
      // Step 1: unlock the workspace.
      .post("/auth/login", validate("json", loginSchema), async (c) => {
        const { email, password } = c.req.valid("json");
        const [workspace] = await db
          .select({ id: workspaces.id, passwordHash: workspaces.passwordHash })
          .from(workspaces)
          .where(eq(workspaces.email, email));
        if (
          !workspace ||
          !(await Bun.password.verify(password, workspace.passwordHash))
        ) {
          throw new ApiError(401, "errors.invalidCredentials");
        }
        const session = await createSession(db, {
          workspaceId: workspace.id,
          userId: null,
        });
        writeSessionCookie(c, session.token, cookie);
        return c.json<AuthStatus>(await statusOf(session));
      })
      // Step 2: pick a user and enter their password.
      .post(
        "/auth/user-login",
        validate("json", userLoginSchema),
        async (c) => {
          const session = await requireSession(c);
          const { userId, password } = c.req.valid("json");
          const all = await listWorkspaceUsers(db, session.workspaceId);
          const user = all.find((u) => u.id === userId);
          if (
            !user ||
            !(await Bun.password.verify(password, user.passwordHash))
          ) {
            throw new ApiError(401, "errors.invalidCredentials");
          }
          await setSessionUser(db, session.token, user.id);
          return c.json<AuthStatus>({
            stage: "user",
            user: toPublicUser(user),
          });
        },
      )
      // Back to picking a user; the workspace stays unlocked.
      .post("/auth/switch-user", async (c) => {
        const session = await requireSession(c);
        await setSessionUser(db, session.token, null);
        return c.json<AuthStatus>(await statusOf({ ...session, userId: null }));
      })
      .post("/auth/logout", async (c) => {
        const session = await findSession(db, readSessionToken(c));
        if (session) await deleteSession(db, session.token);
        clearSessionCookie(c, cookie);
        return c.json<AuthStatus>({ stage: "none" });
      })
      // Any user can change their own password.
      .post(
        "/auth/password",
        requireUser(db),
        validate("json", passwordSchema),
        async (c) => {
          const { current, next } = c.req.valid("json");
          const user = c.var.user;
          if (!(await Bun.password.verify(current, user.passwordHash))) {
            throw new ApiError(400, "errors.wrongPassword");
          }
          await db
            .update(users)
            .set({ passwordHash: await Bun.password.hash(next) })
            .where(eq(users.id, user.id));
          return c.body(null, 204);
        },
      )
  );
}
