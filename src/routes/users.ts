import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import { groups, userGroups, users } from "@/db/schema";
import { ApiError } from "@/errors";
import { recordId } from "@/lib/access";
import * as Schemas from "@/lib/schemas";
import {
  deleteWorkspaceUser,
  findWorkspaceUser,
  listWorkspaceUsers,
  toPublicUser,
} from "@/lib/sessions";
import { requireUser } from "@/middleware/auth";
import { validate } from "@/middleware/validate";
import type { AppEnv } from "@/types/app-env";
import type { Member, PublicUser } from "@/types/responses";

/** Users other than the admin: a non-admin role and at least one group. */
const roleAndGroups = {
  // The admin who created the workspace is its only admin.
  role: z.enum(["contributor", "viewer"], { error: "errors.role" }),
  groupIds: z
    .array(z.uuid({ error: "errors.groupsRequired" }), {
      error: "errors.groupsRequired",
    })
    .min(1, { error: "errors.groupsRequired" })
    .transform((ids) => [...new Set(ids)]),
};

const createUserSchema = z.object({
  name: Schemas.name,
  password: Schemas.password,
  ...roleAndGroups,
});

const updateUserSchema = z.object(roleAndGroups);

const setPasswordSchema = z.object({ password: Schemas.password });

const NOT_FOUND = "errors.userNotFound";

/** Users and their roles and groups; everything but `/members` is admin-only. */
export function createUserRoutes(db: Db) {
  /** Throws unless every group exists in the workspace (and there is one at all). */
  async function assertGroupsExist(workspaceId: string, groupIds: string[]) {
    const existing = await db
      .select({ id: groups.id })
      .from(groups)
      .where(eq(groups.workspaceId, workspaceId));
    if (existing.length === 0) throw new ApiError(400, "errors.noGroups");
    if (!groupIds.every((id) => existing.some((g) => g.id === id))) {
      throw new ApiError(400, "errors.groupsRequired");
    }
  }

  /** The workspace's user with this path id, or 404. */
  async function userOf(workspaceId: string, id: string) {
    const user = await findWorkspaceUser(
      db,
      workspaceId,
      recordId(id, NOT_FOUND),
    );
    if (!user) throw new ApiError(404, NOT_FOUND);
    return user;
  }

  const admin = requireUser(db, { admin: true });

  return (
    new Hono<AppEnv>()
      // Names and roles only, for any logged-in user: shows who added what.
      .get("/members", requireUser(db), async (c) =>
        c.json<Member[]>(
          (await listWorkspaceUsers(db, c.var.user.workspaceId)).map(
            ({ id, name, role }) => ({ id, name, role }),
          ),
        ),
      )
      .get("/users", admin, async (c) =>
        c.json<PublicUser[]>(
          (await listWorkspaceUsers(db, c.var.user.workspaceId)).map(
            toPublicUser,
          ),
        ),
      )
      .post("/users", admin, validate("json", createUserSchema), async (c) => {
        const body = c.req.valid("json");
        const { workspaceId } = c.var.user;
        await assertGroupsExist(workspaceId, body.groupIds);
        // Names only need to be unique inside a workspace, where they are picked from.
        const all = await listWorkspaceUsers(db, workspaceId);
        if (all.some((u) => u.name.toLowerCase() === body.name.toLowerCase())) {
          throw new ApiError(400, "errors.nameTaken");
        }
        const passwordHash = await Bun.password.hash(body.password);
        const user = await db.transaction(async (tx) => {
          const [created] = await tx
            .insert(users)
            .values({
              workspaceId,
              name: body.name,
              role: body.role,
              passwordHash,
            })
            .returning({ id: users.id, name: users.name, role: users.role });
          await tx.insert(userGroups).values(
            body.groupIds.map((groupId) => ({
              userId: created!.id,
              groupId,
            })),
          );
          return created!;
        });
        return c.json<PublicUser>({ ...user, groupIds: body.groupIds }, 201);
      })
      // Changes the role and groups of a user other than the admin.
      .put(
        "/users/:id",
        admin,
        validate("json", updateUserSchema),
        async (c) => {
          const body = c.req.valid("json");
          const { workspaceId } = c.var.user;
          const user = await userOf(workspaceId, c.req.param("id"));
          // The admin's role and (empty) groups never change.
          if (user.role === "admin")
            throw new ApiError(400, "errors.adminFixed");
          await assertGroupsExist(workspaceId, body.groupIds);
          await db.transaction(async (tx) => {
            await tx
              .update(users)
              .set({ role: body.role })
              .where(eq(users.id, user.id));
            await tx.delete(userGroups).where(eq(userGroups.userId, user.id));
            await tx
              .insert(userGroups)
              .values(
                body.groupIds.map((groupId) => ({ userId: user.id, groupId })),
              );
          });
          return c.json<PublicUser>(
            toPublicUser({ ...user, role: body.role, groupIds: body.groupIds }),
          );
        },
      )
      // Their records stay; whoever is logged in as them goes back to picking a user.
      .delete("/users/:id", admin, async (c) => {
        const { workspaceId, id: adminId } = c.var.user;
        // The admin cannot delete themselves, so the workspace always has one.
        if (c.req.param("id") === adminId) {
          throw new ApiError(400, "errors.cannotDeleteSelf");
        }
        const user = await userOf(workspaceId, c.req.param("id"));
        await deleteWorkspaceUser(db, workspaceId, user.id);
        return c.body(null, 204);
      })
      .put(
        "/users/:id/password",
        admin,
        validate("json", setPasswordSchema),
        async (c) => {
          const { workspaceId } = c.var.user;
          const user = await userOf(workspaceId, c.req.param("id"));
          await db
            .update(users)
            .set({
              passwordHash: await Bun.password.hash(
                c.req.valid("json").password,
              ),
            })
            .where(
              and(eq(users.id, user.id), eq(users.workspaceId, workspaceId)),
            );
          return c.body(null, 204);
        },
      )
  );
}
