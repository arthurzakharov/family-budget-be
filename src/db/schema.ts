/**
 * Database tables. Property names are camelCase in code and snake_case in
 * Postgres (`casing: "snake_case"` in `drizzle.config.ts` and `src/db/client.ts`).
 * After changing this file, run `bun run db:generate` to create a migration.
 *
 * Every record belongs to a workspace (one household). Money amounts are
 * positive integers in euro cents (12.34 € = 1234), never floats. Crypto
 * amounts and prices are `numeric`, since they need fractions of a coin and of
 * a cent.
 */
import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

const createdAt = () =>
  timestamp({ withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

/** admin: the workspace's creator and only admin; contributor: adds and changes records; viewer: only looks. */
export const role = pgEnum("role", ["admin", "contributor", "viewer"]);

export const depositTransactionType = pgEnum("deposit_transaction_type", [
  "deposit",
  "withdrawal",
]);

export const cryptoTransactionType = pgEnum("crypto_transaction_type", [
  "buy",
  "sell",
]);

/** Whether a category's entries bring money in or take it out. */
export const categoryKind = pgEnum("category_kind", ["expense", "income"]);

/** One household. Logging in finds the workspace by its (unique) email. */
export const workspaces = pgTable("workspaces", {
  id: uuid().primaryKey().defaultRandom(),
  email: varchar({ length: 254 }).notNull().unique(),
  passwordHash: text().notNull(),
  /** Coins the workspace trades; `null` until the admin picks, meaning the defaults. */
  enabledCoins: text().array(),
  /** Last fetched price of each coin in euros, keyed by symbol; `null` until first fetched. */
  coinPrices: jsonb().$type<Record<string, number>>(),
  /** When `coinPrices` were fetched. */
  coinPricesFetchedAt: timestamp({ withTimezone: true }),
  /** Category ids (built-in or custom) that cannot be picked for new entries. */
  hiddenCategories: text()
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  createdAt: createdAt(),
});

/** A person in a workspace; names are unique per workspace (case-insensitive). */
export const users = pgTable(
  "users",
  {
    id: uuid().primaryKey().defaultRandom(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: varchar({ length: 100 }).notNull(),
    role: role().notNull(),
    passwordHash: text().notNull(),
    createdAt: createdAt(),
  },
  (table) => [index("users_workspace_id_idx").on(table.workspaceId)],
);

/** Who money belongs to, e.g. "Family" or "Father"; names are unique per workspace. */
export const groups = pgTable(
  "groups",
  {
    id: uuid().primaryKey().defaultRandom(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: varchar({ length: 100 }).notNull(),
    createdAt: createdAt(),
  },
  (table) => [index("groups_workspace_id_idx").on(table.workspaceId)],
);

/** Group membership. The admin never belongs to a group; everyone else to at least one. */
export const userGroups = pgTable(
  "user_groups",
  {
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    groupId: uuid()
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.userId, table.groupId] })],
);

/** A login. `userId` is null until a user is picked in the second login step. */
export const sessions = pgTable(
  "sessions",
  {
    token: text().primaryKey(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: uuid().references(() => users.id, { onDelete: "set null" }),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
  },
  (table) => [index("sessions_expires_at_idx").on(table.expiresAt)],
);

/**
 * Columns every group record has: the workspace, the user it was added under
 * (records stay when that user is deleted) and the group the money belongs to.
 */
const recordColumns = () => ({
  id: uuid().primaryKey().defaultRandom(),
  workspaceId: uuid()
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  userId: uuid().references(() => users.id, { onDelete: "set null" }),
  groupId: uuid()
    .notNull()
    .references(() => groups.id, { onDelete: "restrict" }),
  /** Day the money moved, as `YYYY-MM-DD`. */
  date: date({ mode: "string" }).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Money put into or taken out of the interest-bearing deposit. */
export const depositTransactions = pgTable(
  "deposit_transactions",
  {
    ...recordColumns(),
    type: depositTransactionType().notNull(),
    amountCents: integer().notNull(),
  },
  (table) => [
    check(
      "deposit_transactions_amount_cents_positive",
      sql`${table.amountCents} > 0`,
    ),
    index("deposit_transactions_workspace_id_date_idx").on(
      table.workspaceId,
      table.date,
    ),
  ],
);

/** The deposit's yearly interest rate (percent) over a period; periods never overlap. */
export const depositRates = pgTable(
  "deposit_rates",
  {
    id: uuid().primaryKey().defaultRandom(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: uuid().references(() => users.id, { onDelete: "set null" }),
    ratePercent: numeric({ precision: 7, scale: 4, mode: "number" }).notNull(),
    /** `null` means "from the beginning". */
    from: date({ mode: "string" }),
    /** `null` means "till now" (the rate is still current). */
    till: date({ mode: "string" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    check(
      "deposit_rates_rate_percent_range",
      sql`${table.ratePercent} >= 0 and ${table.ratePercent} <= 100`,
    ),
    index("deposit_rates_workspace_id_idx").on(table.workspaceId),
  ],
);

/** A buy or sell of a coin; `price` is what one coin cost in euros. */
export const cryptoTransactions = pgTable(
  "crypto_transactions",
  {
    ...recordColumns(),
    coin: varchar({ length: 10 }).notNull(),
    type: cryptoTransactionType().notNull(),
    amount: numeric({ precision: 38, scale: 18, mode: "number" }).notNull(),
    price: numeric({ precision: 38, scale: 18, mode: "number" }).notNull(),
  },
  (table) => [
    check("crypto_transactions_amount_positive", sql`${table.amount} > 0`),
    check("crypto_transactions_price_positive", sql`${table.price} > 0`),
    index("crypto_transactions_workspace_id_date_idx").on(
      table.workspaceId,
      table.date,
    ),
  ],
);

/** A category the admin created, next to the built-in ones (which live in code). */
export const expenseCategories = pgTable(
  "expense_categories",
  {
    id: uuid().primaryKey().defaultRandom(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    kind: categoryKind().notNull(),
    name: varchar({ length: 100 }).notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    index("expense_categories_workspace_id_idx").on(table.workspaceId),
  ],
);

/**
 * One expense or income. `categoryId` is a built-in category id (e.g.
 * `groceries`) or a custom category's uuid, so it has no foreign key;
 * the category's kind gives the direction.
 */
export const expenseEntries = pgTable(
  "expense_entries",
  {
    ...recordColumns(),
    categoryId: varchar({ length: 64 }).notNull(),
    amountCents: integer().notNull(),
    note: varchar({ length: 200 }).notNull().default(""),
  },
  (table) => [
    check(
      "expense_entries_amount_cents_positive",
      sql`${table.amountCents} > 0`,
    ),
    index("expense_entries_workspace_id_date_idx").on(
      table.workspaceId,
      table.date,
    ),
  ],
);
