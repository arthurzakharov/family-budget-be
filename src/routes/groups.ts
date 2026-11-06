import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import { groups, userGroups } from "@/db/schema";
import { ApiError } from "@/errors";
import * as Schemas from "@/lib/schemas";
import { findWorkspaceUser } from "@/lib/sessions";
import { requireUser } from "@/middleware/auth";
import { validate } from "@/middleware/validate";
import type { AppEnv } from "@/types/app-env";
import type { Group } from "@/types/responses";

const createGroupSchema = z.object({ name: Schemas.name });

const addMemberSchema = z.object({
  userId: z.string({ error: "errors.userNotFound" }),
});

/** Groups (who money belongs to) and their members; changes are admin-only. */
export function createGroupRoutes(db: Db) {
  async function listGroups(workspaceId: string): Promise<Group[]> {
    return db
      .select({ id: groups.id, name: groups.name })
      .from(groups)
      .where(eq(groups.workspaceId, workspaceId))
      .orderBy(groups.createdAt, groups.id);
  }

  /** The group and user of the admin's workspace, or 404. */
  async function groupAndUser(
    workspaceId: string,
    groupId: string,
    userId: string,
  ) {
    const all = await listGroups(workspaceId);
    const group = all.find((g) => g.id === groupId);
    if (!group) throw new ApiError(404, "errors.groupNotFound");
    const user = await findWorkspaceUser(db, workspaceId, userId);
    if (!user) throw new ApiError(404, "errors.userNotFound");
    return { group, user };
  }

  const admin = requireUser(db, { admin: true });

  return (
    new Hono<AppEnv>()
      // Every user needs the groups to see whose money is whose.
      .get("/groups", requireUser(db), async (c) =>
        c.json<Group[]>(await listGroups(c.var.user.workspaceId)),
      )
      .post(
        "/groups",
        admin,
        validate("json", createGroupSchema),
        async (c) => {
          const { name } = c.req.valid("json");
          const { workspaceId } = c.var.user;
          const all = await listGroups(workspaceId);
          if (all.some((g) => g.name.toLowerCase() === name.toLowerCase())) {
            throw new ApiError(400, "errors.groupNameTaken");
          }
          const [group] = await db
            .insert(groups)
            .values({ workspaceId, name })
            .returning({ id: groups.id, name: groups.name });
          return c.json<Group>(group!, 201);
        },
      )
      .post(
        "/groups/:id/members",
        admin,
        validate("json", addMemberSchema),
        async (c) => {
          const { group, user } = await groupAndUser(
            c.var.user.workspaceId,
            c.req.param("id"),
            c.req.valid("json").userId,
          );
          // The admin stands apart and never belongs to a group.
          if (user.role === "admin")
            throw new ApiError(400, "errors.adminNoGroups");
          await db
            .insert(userGroups)
            .values({ userId: user.id, groupId: group.id })
            .onConflictDoNothing();
          return c.body(null, 204);
        },
      )
      .delete("/groups/:id/members/:userId", admin, async (c) => {
        const { group, user } = await groupAndUser(
          c.var.user.workspaceId,
          c.req.param("id"),
          c.req.param("userId"),
        );
        // Every user other than the admin belongs to at least one group.
        if (user.groupIds.length === 1 && user.groupIds[0] === group.id) {
          throw new ApiError(400, "errors.lastGroup");
        }
        await db
          .delete(userGroups)
          .where(
            and(
              eq(userGroups.userId, user.id),
              eq(userGroups.groupId, group.id),
            ),
          );
        return c.body(null, 204);
      })
  );
}
