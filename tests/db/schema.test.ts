import { describe, expect, test } from "bun:test";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import * as schema from "@/db/schema";

const tables: PgTable[] = Object.values(schema).flatMap((value) =>
  value instanceof PgTable ? [value] : [],
);

/** `table.column -> table.column` for every foreign key. */
function foreignKeys(): string[] {
  return tables.flatMap((table) => {
    const config = getTableConfig(table);
    return config.foreignKeys.map((fk) => {
      const { columns, foreignTable, foreignColumns } = fk.reference();
      return `${config.name}.${columns[0]!.name} -> ${getTableConfig(foreignTable).name}.${foreignColumns[0]!.name} (${fk.onDelete})`;
    });
  });
}

describe("schema", () => {
  test("every record belongs to a workspace, and records outlive their user", () => {
    expect(foreignKeys().toSorted()).toEqual([
      "crypto_transactions.groupId -> groups.id (restrict)",
      "crypto_transactions.userId -> users.id (set null)",
      "crypto_transactions.workspaceId -> workspaces.id (cascade)",
      "deposit_rates.userId -> users.id (set null)",
      "deposit_rates.workspaceId -> workspaces.id (cascade)",
      "deposit_transactions.groupId -> groups.id (restrict)",
      "deposit_transactions.userId -> users.id (set null)",
      "deposit_transactions.workspaceId -> workspaces.id (cascade)",
      "expense_categories.workspaceId -> workspaces.id (cascade)",
      "expense_entries.groupId -> groups.id (restrict)",
      "expense_entries.userId -> users.id (set null)",
      "expense_entries.workspaceId -> workspaces.id (cascade)",
      "groups.workspaceId -> workspaces.id (cascade)",
      "sessions.userId -> users.id (set null)",
      "sessions.workspaceId -> workspaces.id (cascade)",
      "user_groups.groupId -> groups.id (cascade)",
      "user_groups.userId -> users.id (cascade)",
      "users.workspaceId -> workspaces.id (cascade)",
    ]);
  });
});
