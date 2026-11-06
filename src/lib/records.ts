import { and, eq, inArray, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import type { CurrentUser } from "@/lib/sessions";

/** Columns every group record table has. */
type RecordTable = {
  id: PgColumn;
  workspaceId: PgColumn;
  groupId: PgColumn;
};

/**
 * Filters a group record table to what the user may see: their workspace and,
 * unless they are the admin, their groups.
 */
export function visibleTo(table: RecordTable, user: CurrentUser): SQL {
  const inWorkspace = eq(table.workspaceId, user.workspaceId);
  return user.role === "admin"
    ? inWorkspace
    : and(inWorkspace, inArray(table.groupId, user.groupIds))!;
}

/** Filters to the one record with `id`, if the user may see it. */
export function visibleRecord(
  table: RecordTable,
  user: CurrentUser,
  id: string,
): SQL {
  return and(visibleTo(table, user), eq(table.id, id))!;
}
