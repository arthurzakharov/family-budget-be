import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { PriceSource } from "@/api/coingecko";
import type { Db } from "@/db/client";
import { cryptoTransactions, workspaces } from "@/db/schema";
import { ApiError } from "@/errors";
import { assertUsableGroup, chosenUserId, recordId } from "@/lib/access";
import { COINS, enabledCoins } from "@/lib/coins";
import { visibleRecord, visibleTo } from "@/lib/records";
import * as Schemas from "@/lib/schemas";
import type { CurrentUser } from "@/lib/sessions";
import { requireUser } from "@/middleware/auth";
import { validate } from "@/middleware/validate";
import type { AppEnv } from "@/types/app-env";
import type {
  CoinPrices,
  CoinSymbol,
  CryptoTransaction,
} from "@/types/responses";

const coin = z.enum(COINS, { error: "errors.coin" });

const coinsSchema = z.object({
  enabled: z.array(coin, { error: "errors.coin" }),
});

const transactionSchema = z.object({
  groupId: Schemas.groupId,
  coin,
  type: z.enum(["buy", "sell"], { error: "errors.cryptoType" }),
  date: Schemas.date(),
  amount: Schemas.positiveDecimal("errors.amount"),
  price: Schemas.positiveDecimal("errors.cryptoRate"),
  userId: Schemas.recordUserId,
});

const columns = {
  id: cryptoTransactions.id,
  userId: cryptoTransactions.userId,
  groupId: cryptoTransactions.groupId,
  date: cryptoTransactions.date,
  coin: cryptoTransactions.coin,
  type: cryptoTransactions.type,
  amount: cryptoTransactions.amount,
  price: cryptoTransactions.price,
};

const NOT_FOUND = "errors.transactionNotFound";

/**
 * Prices fetched less than this long ago are returned as they are instead of
 * asking CoinGecko again, so repeated clicks (or several family members at
 * once) stay within its rate limits.
 */
export const PRICES_FRESH_MS = 60_000;

type CryptoRoutesParams = {
  db: Db;
  /** Where current coin prices come from (CoinGecko in production). */
  prices: PriceSource;
  /** The current time; injectable for tests. */
  now: () => Date;
};

/** Rows hold any text in `coin`; the API only ever writes `CoinSymbol`s. */
const toTransaction = (
  row: { coin: string } & Omit<CryptoTransaction, "coin">,
) => row as CryptoTransaction;

/**
 * Crypto buys and sells. Everyone reads the coins the workspace trades, only
 * the admin changes them. Reading transactions is for everyone, changes need
 * a non-viewer; both only within the user's groups. Current prices are fetched
 * only on request (anyone may ask) and kept on the workspace, so everyone
 * sees the same prices without further calls to the price API.
 */
export function createCryptoRoutes({ db, prices, now }: CryptoRoutesParams) {
  async function storedPrices(workspaceId: string) {
    const [workspace] = await db
      .select({
        enabledCoins: workspaces.enabledCoins,
        coinPrices: workspaces.coinPrices,
        coinPricesFetchedAt: workspaces.coinPricesFetchedAt,
      })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId));
    return workspace!;
  }

  const toCoinPrices = (
    coinPrices: Record<string, number> | null,
    fetchedAt: Date | null,
  ): CoinPrices => ({
    prices: coinPrices ?? {},
    fetchedAt: fetchedAt?.toISOString() ?? null,
  });

  async function coinsOf(workspaceId: string): Promise<CoinSymbol[]> {
    const [workspace] = await db
      .select({ enabledCoins: workspaces.enabledCoins })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId));
    return enabledCoins(workspace!.enabledCoins);
  }

  /**
   * Throws unless the coin is traded and the group usable. When editing, the
   * record's own coin stays allowed even if the admin has turned it off since.
   */
  async function assertValid(
    user: CurrentUser,
    body: { coin: CoinSymbol; groupId: string },
    existingCoin?: string,
  ) {
    const coins = await coinsOf(user.workspaceId);
    if (!coins.includes(body.coin) && body.coin !== existingCoin) {
      throw new ApiError(400, "errors.coin");
    }
    await assertUsableGroup(db, user, body.groupId);
  }

  async function findTransaction(user: CurrentUser, id: string) {
    const [found] = await db
      .select(columns)
      .from(cryptoTransactions)
      .where(visibleRecord(cryptoTransactions, user, recordId(id, NOT_FOUND)));
    if (!found) throw new ApiError(404, NOT_FOUND);
    return found;
  }

  const reader = requireUser(db);
  const editor = requireUser(db, { edit: true });

  return new Hono<AppEnv>()
    .get("/crypto/coins", reader, async (c) =>
      c.json<CoinSymbol[]>(await coinsOf(c.var.user.workspaceId)),
    )
    .put(
      "/crypto/coins",
      requireUser(db, { admin: true }),
      validate("json", coinsSchema),
      async (c) => {
        const enabled = [...new Set(c.req.valid("json").enabled)];
        await db
          .update(workspaces)
          .set({ enabledCoins: enabled })
          .where(eq(workspaces.id, c.var.user.workspaceId));
        return c.json<CoinSymbol[]>(enabled);
      },
    )
    .get("/crypto/prices", reader, async (c) => {
      const stored = await storedPrices(c.var.user.workspaceId);
      return c.json<CoinPrices>(
        toCoinPrices(stored.coinPrices, stored.coinPricesFetchedAt),
      );
    })
    .post("/crypto/prices", reader, async (c) => {
      const workspaceId = c.var.user.workspaceId;
      const stored = await storedPrices(workspaceId);
      const coins = enabledCoins(stored.enabledCoins);
      const fetchedAt = stored.coinPricesFetchedAt;
      // Recently fetched and covering every traded coin: nothing to ask for.
      const fresh =
        fetchedAt !== null &&
        now().getTime() - fetchedAt.getTime() < PRICES_FRESH_MS &&
        coins.every((coin) => stored.coinPrices?.[coin] !== undefined);
      if (fresh) {
        return c.json<CoinPrices>(toCoinPrices(stored.coinPrices, fetchedAt));
      }
      // Coins turned off keep their last price, so old holdings still have one.
      const merged = {
        ...stored.coinPrices,
        ...(await prices.eurPrices(coins)),
      };
      const at = now();
      await db
        .update(workspaces)
        .set({ coinPrices: merged, coinPricesFetchedAt: at })
        .where(eq(workspaces.id, workspaceId));
      return c.json<CoinPrices>(toCoinPrices(merged, at));
    })
    .get("/crypto/transactions", reader, async (c) =>
      c.json<CryptoTransaction[]>(
        (
          await db
            .select(columns)
            .from(cryptoTransactions)
            .where(visibleTo(cryptoTransactions, c.var.user))
            .orderBy(cryptoTransactions.date, cryptoTransactions.createdAt)
        ).map(toTransaction),
      ),
    )
    .post(
      "/crypto/transactions",
      editor,
      validate("json", transactionSchema),
      async (c) => {
        const { userId, ...body } = c.req.valid("json");
        const user = c.var.user;
        await assertValid(user, body);
        const owner = (await chosenUserId(db, user, userId)) ?? user.id;
        const [created] = await db
          .insert(cryptoTransactions)
          .values({ ...body, workspaceId: user.workspaceId, userId: owner })
          .returning(columns);
        return c.json<CryptoTransaction>(toTransaction(created!), 201);
      },
    )
    .put(
      "/crypto/transactions/:id",
      editor,
      validate("json", transactionSchema),
      async (c) => {
        const { userId, ...body } = c.req.valid("json");
        const user = c.var.user;
        const existing = await findTransaction(user, c.req.param("id"));
        await assertValid(user, body, existing.coin);
        // Keeps the user unless the admin picked another one.
        const owner = await chosenUserId(db, user, userId);
        const [updated] = await db
          .update(cryptoTransactions)
          .set({ ...body, ...(owner && { userId: owner }) })
          .where(eq(cryptoTransactions.id, existing.id))
          .returning(columns);
        return c.json<CryptoTransaction>(toTransaction(updated!));
      },
    )
    .delete("/crypto/transactions/:id", editor, async (c) => {
      const existing = await findTransaction(c.var.user, c.req.param("id"));
      await db
        .delete(cryptoTransactions)
        .where(eq(cryptoTransactions.id, existing.id));
      return c.body(null, 204);
    });
}
