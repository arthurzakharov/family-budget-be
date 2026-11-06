import { Hono } from "hono";
import { and, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import { depositRates, depositTransactions, groups } from "@/db/schema";
import { ApiError } from "@/errors";
import { assertUsableGroup, chosenUserId, recordId } from "@/lib/access";
import { calculateInterest, forGroups } from "@/lib/interest";
import { visibleRecord, visibleTo } from "@/lib/records";
import * as Schemas from "@/lib/schemas";
import type { CurrentUser } from "@/lib/sessions";
import { requireUser } from "@/middleware/auth";
import { validate } from "@/middleware/validate";
import type { AppEnv } from "@/types/app-env";
import type {
  DepositRate,
  DepositTransaction,
  InterestSummary,
} from "@/types/responses";

const transactionSchema = z.object({
  groupId: Schemas.groupId,
  type: z.enum(["deposit", "withdrawal"], { error: "errors.type" }),
  date: Schemas.date(),
  amountCents: Schemas.amountCents,
  userId: Schemas.recordUserId,
});

const rateSchema = z
  .object({
    ratePercent: z
      .number({ error: "errors.rate" })
      .min(0, { error: "errors.rate" })
      .max(100, { error: "errors.rate" }),
    from: Schemas.date("errors.from").nullable(),
    till: Schemas.date("errors.till").nullable(),
    userId: Schemas.recordUserId,
  })
  .refine((r) => r.from === null || r.till === null || r.from <= r.till, {
    error: "errors.fromAfterTill",
    path: ["till"],
  });

type Period = { from: string | null; till: string | null };

const overlaps = (a: Period, b: Period): boolean =>
  (a.from === null || b.till === null || a.from <= b.till) &&
  (b.from === null || a.till === null || b.from <= a.till);

const transactionColumns = {
  id: depositTransactions.id,
  userId: depositTransactions.userId,
  groupId: depositTransactions.groupId,
  date: depositTransactions.date,
  type: depositTransactions.type,
  amountCents: depositTransactions.amountCents,
};

const rateColumns = {
  id: depositRates.id,
  userId: depositRates.userId,
  ratePercent: depositRates.ratePercent,
  from: depositRates.from,
  till: depositRates.till,
};

const TRANSACTION_NOT_FOUND = "errors.transactionNotFound";
const RATE_NOT_FOUND = "errors.rateNotFound";

type CreateDepositRoutesParams = {
  db: Db;
  /** Today as `YYYY-MM-DD`; interest is earned up to this day. */
  today: () => string;
};

/**
 * The interest-bearing deposit: money put in and taken out, the interest rate
 * over time and the interest it earned. Reading is for everyone, changes need
 * a non-viewer; transactions only within the user's groups.
 */
export function createDepositRoutes({ db, today }: CreateDepositRoutesParams) {
  /** Throws unless the transaction is in the workspace and its group usable. */
  async function findTransaction(user: CurrentUser, id: string) {
    const [found] = await db
      .select({ id: depositTransactions.id })
      .from(depositTransactions)
      .where(
        visibleRecord(
          depositTransactions,
          user,
          recordId(id, TRANSACTION_NOT_FOUND),
        ),
      );
    if (!found) throw new ApiError(404, TRANSACTION_NOT_FOUND);
    return found.id;
  }

  /** Throws `errors.overlap` if `period` overlaps another period of the workspace. */
  async function assertNoOverlap(
    workspaceId: string,
    period: Period,
    exceptId?: string,
  ) {
    const others = await db
      .select(rateColumns)
      .from(depositRates)
      .where(
        and(
          eq(depositRates.workspaceId, workspaceId),
          exceptId === undefined ? undefined : ne(depositRates.id, exceptId),
        ),
      );
    if (others.some((r) => overlaps(period, r))) {
      throw new ApiError(400, "errors.overlap");
    }
  }

  const reader = requireUser(db);
  const editor = requireUser(db, { edit: true });

  return (
    new Hono<AppEnv>()
      .get("/deposit/transactions", reader, async (c) =>
        c.json<DepositTransaction[]>(
          await db
            .select(transactionColumns)
            .from(depositTransactions)
            .where(visibleTo(depositTransactions, c.var.user))
            .orderBy(depositTransactions.date, depositTransactions.createdAt),
        ),
      )
      .post(
        "/deposit/transactions",
        editor,
        validate("json", transactionSchema),
        async (c) => {
          const { userId, ...body } = c.req.valid("json");
          const user = c.var.user;
          await assertUsableGroup(db, user, body.groupId);
          const owner = (await chosenUserId(db, user, userId)) ?? user.id;
          const [created] = await db
            .insert(depositTransactions)
            .values({ ...body, workspaceId: user.workspaceId, userId: owner })
            .returning(transactionColumns);
          return c.json<DepositTransaction>(created!, 201);
        },
      )
      .put(
        "/deposit/transactions/:id",
        editor,
        validate("json", transactionSchema),
        async (c) => {
          const { userId, ...body } = c.req.valid("json");
          const user = c.var.user;
          const id = await findTransaction(user, c.req.param("id"));
          await assertUsableGroup(db, user, body.groupId);
          // Keeps the user unless the admin picked another one.
          const owner = await chosenUserId(db, user, userId);
          const [updated] = await db
            .update(depositTransactions)
            .set({ ...body, ...(owner && { userId: owner }) })
            .where(eq(depositTransactions.id, id))
            .returning(transactionColumns);
          return c.json<DepositTransaction>(updated!);
        },
      )
      .delete("/deposit/transactions/:id", editor, async (c) => {
        const id = await findTransaction(c.var.user, c.req.param("id"));
        await db
          .delete(depositTransactions)
          .where(eq(depositTransactions.id, id));
        return c.body(null, 204);
      })
      // Rates apply to the whole deposit, so everyone in the workspace sees them all.
      .get("/deposit/rates", reader, async (c) =>
        c.json<DepositRate[]>(
          await db
            .select(rateColumns)
            .from(depositRates)
            .where(eq(depositRates.workspaceId, c.var.user.workspaceId))
            // Oldest first; "from the beginning" (null) before everything.
            .orderBy(sql`${depositRates.from} asc nulls first`),
        ),
      )
      .post(
        "/deposit/rates",
        editor,
        validate("json", rateSchema),
        async (c) => {
          const { userId, ...body } = c.req.valid("json");
          const user = c.var.user;
          await assertNoOverlap(user.workspaceId, body);
          const owner = (await chosenUserId(db, user, userId)) ?? user.id;
          const [created] = await db
            .insert(depositRates)
            .values({ ...body, workspaceId: user.workspaceId, userId: owner })
            .returning(rateColumns);
          return c.json<DepositRate>(created!, 201);
        },
      )
      .put(
        "/deposit/rates/:id",
        editor,
        validate("json", rateSchema),
        async (c) => {
          const { userId, ...body } = c.req.valid("json");
          const user = c.var.user;
          const id = recordId(c.req.param("id"), RATE_NOT_FOUND);
          const [existing] = await db
            .select({ id: depositRates.id })
            .from(depositRates)
            .where(
              and(
                eq(depositRates.id, id),
                eq(depositRates.workspaceId, user.workspaceId),
              ),
            );
          if (!existing) throw new ApiError(404, RATE_NOT_FOUND);
          // The period being edited may overlap its own old dates.
          await assertNoOverlap(user.workspaceId, body, id);
          const owner = await chosenUserId(db, user, userId);
          const [updated] = await db
            .update(depositRates)
            .set({ ...body, ...(owner && { userId: owner }) })
            .where(eq(depositRates.id, id))
            .returning(rateColumns);
          return c.json<DepositRate>(updated!);
        },
      )
      // Interest is worked out on the whole deposit, since tax is withheld on
      // the whole payout and then split between groups. Users other than the
      // admin only get their own groups' share of it.
      .get("/deposit/interest", reader, async (c) => {
        const user = c.var.user;
        const { workspaceId } = user;
        const [transactions, rates, groupRows] = await Promise.all([
          db
            .select(transactionColumns)
            .from(depositTransactions)
            .where(eq(depositTransactions.workspaceId, workspaceId)),
          db
            .select(rateColumns)
            .from(depositRates)
            .where(eq(depositRates.workspaceId, workspaceId)),
          db
            .select({ id: groups.id })
            .from(groups)
            .where(eq(groups.workspaceId, workspaceId)),
        ]);
        const all = calculateInterest({
          transactions,
          rates,
          today: today(),
          groupIds: groupRows.map((g) => g.id),
        });
        return c.json<InterestSummary>(
          user.role === "admin" ? all : forGroups(all, user.groupIds),
        );
      })
  );
}
