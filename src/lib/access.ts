import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { groups } from "@/db/schema";
import { ApiError } from "@/errors";
import { listWorkspaceUsers, type CurrentUser } from "@/lib/sessions";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The path's id if it can be a record id, otherwise a 404 with `code`. */
export function recordId(id: string, code: string): string {
  if (!UUID.test(id)) throw new ApiError(404, code);
  return id;
}

/**
 * The admin sees every group; everyone else only the groups they belong to.
 * Records of other groups never leave the server.
 */
export function canUseGroup(user: CurrentUser, groupId: string): boolean {
  return user.role === "admin" || user.groupIds.includes(groupId);
}

/** Throws 400 `errors.group` unless the group is in the workspace and usable by the user. */
export async function assertUsableGroup(
  db: Db,
  user: CurrentUser,
  groupId: string,
): Promise<void> {
  const [group] = await db
    .select({ id: groups.id })
    .from(groups)
    .where(
      and(eq(groups.id, groupId), eq(groups.workspaceId, user.workspaceId)),
    );
  if (!group || !canUseGroup(user, groupId)) {
    throw new ApiError(400, "errors.group");
  }
}

/**
 * Which user a new or edited record goes under. Admins never add records
 * under their own name, so for them `userId` must name a non-admin user of
 * the workspace (400 `errors.user` otherwise). Everyone else gets `undefined`:
 * their records go under their own name and keep it when edited.
 */
export async function chosenUserId(
  db: Db,
  user: CurrentUser,
  userId: string | null | undefined,
): Promise<string | undefined> {
  if (user.role !== "admin") return undefined;
  const all = await listWorkspaceUsers(db, user.workspaceId);
  if (!all.some((u) => u.id === userId && u.role !== "admin")) {
    throw new ApiError(400, "errors.user");
  }
  return userId!;
}
