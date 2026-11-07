import { beforeAll, describe, expect, test } from "bun:test";
import type { Db } from "@/db/client";
import type {
  CoinPrices,
  CryptoTransaction,
  ErrorResponse,
} from "@/types/responses";
import {
  Browser,
  createTestApp,
  fakeClock,
  fakePrices,
  setupWorkspace,
} from "@tests/helpers/api";
import { createTestDb } from "@tests/helpers/db";

let db: Db;
beforeAll(async () => {
  db = await createTestDb();
});

const codeOf = async (res: Response): Promise<string | undefined> =>
  ((await res.json()) as ErrorResponse).code;

const tx = (groupId: string, over: object = {}) => ({
  groupId,
  coin: "BTC",
  type: "buy",
  date: "2026-01-01",
  amount: 0.00012345,
  price: 91234.56,
  ...over,
});

describe("crypto coins", () => {
  test("default coins until the admin picks; only the admin changes them", async () => {
    const ws = await setupWorkspace(db);

    expect(await ws.viewer.json("GET", "/crypto/coins")).toEqual([
      "BTC",
      "ETH",
      "XRP",
      "BNB",
      "SOL",
    ]);
    expect(
      await ws.admin.json("PUT", "/crypto/coins", {
        enabled: ["DOGE", "BTC", "DOGE"],
      }),
    ).toEqual(["DOGE", "BTC"]);
    expect(await ws.viewer.json("GET", "/crypto/coins")).toEqual([
      "BTC",
      "DOGE",
    ]);
    expect(
      (await ws.contributor.request("PUT", "/crypto/coins", { enabled: [] }))
        .status,
    ).toBe(403);
    expect(
      await codeOf(
        await ws.admin.request("PUT", "/crypto/coins", { enabled: ["NOPE"] }),
      ),
    ).toBe("errors.coin");
  });
});

describe("crypto transactions", () => {
  test("users add buys and sells in their groups and see only those", async () => {
    const ws = await setupWorkspace(db);

    const mine = await ws.contributor.json<CryptoTransaction>(
      "POST",
      "/crypto/transactions",
      tx(ws.g1.id),
      201,
    );
    await ws.other.json(
      "POST",
      "/crypto/transactions",
      tx(ws.g2.id, { type: "sell" }),
      201,
    );

    expect(mine).toEqual({
      id: expect.any(String),
      userId: ws.users.contributor.id,
      groupId: ws.g1.id,
      date: "2026-01-01",
      coin: "BTC",
      type: "buy",
      amount: 0.00012345,
      price: 91234.56,
    });
    expect(await ws.viewer.json("GET", "/crypto/transactions")).toEqual([mine]);
    expect(
      await ws.admin.json<unknown[]>("GET", "/crypto/transactions"),
    ).toHaveLength(2);
    expect(
      (await ws.viewer.request("POST", "/crypto/transactions", tx(ws.g1.id)))
        .status,
    ).toBe(403);
    expect(
      await codeOf(
        await ws.contributor.request(
          "POST",
          "/crypto/transactions",
          tx(ws.g2.id),
        ),
      ),
    ).toBe("errors.group");
  });

  test("validates the body with translation keys", async () => {
    const ws = await setupWorkspace(db);

    const cases: [object, string][] = [
      [{ coin: "NOPE" }, "errors.coin"],
      [{ coin: "DOGE" }, "errors.coin"],
      [{ type: "swap" }, "errors.cryptoType"],
      [{ date: "" }, "errors.date"],
      [{ amount: -1 }, "errors.amount"],
      [{ price: 0 }, "errors.cryptoRate"],
    ];
    for (const [over, code] of cases) {
      const res = await ws.contributor.request(
        "POST",
        "/crypto/transactions",
        tx(ws.g1.id, over),
      );
      expect(res.status).toBe(400);
      expect(await codeOf(res)).toBe(code);
    }
  });

  test("an edited record keeps its coin even after the admin turns it off", async () => {
    const ws = await setupWorkspace(db);
    const created = await ws.contributor.json<CryptoTransaction>(
      "POST",
      "/crypto/transactions",
      tx(ws.g1.id),
      201,
    );
    await ws.admin.json("PUT", "/crypto/coins", { enabled: ["ETH"] });

    const edited = await ws.contributor.json<CryptoTransaction>(
      "PUT",
      `/crypto/transactions/${created.id}`,
      tx(ws.g1.id, { amount: 2 }),
    );
    const moved = await ws.admin.json<CryptoTransaction>(
      "PUT",
      `/crypto/transactions/${created.id}`,
      tx(ws.g1.id, { userId: ws.users.contributor.id }),
    );
    const otherCoin = await ws.contributor.request(
      "PUT",
      `/crypto/transactions/${created.id}`,
      tx(ws.g1.id, { coin: "SOL" }),
    );

    expect(edited).toMatchObject({
      coin: "BTC",
      amount: 2,
      userId: ws.users.contributor.id,
    });
    expect(moved.userId).toBe(ws.users.contributor.id);
    expect(await codeOf(otherCoin)).toBe("errors.coin");
  });

  test("deletes visible records; others are not found", async () => {
    const ws = await setupWorkspace(db);
    const created = await ws.contributor.json<CryptoTransaction>(
      "POST",
      "/crypto/transactions",
      tx(ws.g1.id),
      201,
    );

    const hidden = await ws.other.request(
      "DELETE",
      `/crypto/transactions/${created.id}`,
    );
    expect(hidden.status).toBe(404);
    expect(await codeOf(hidden)).toBe("errors.transactionNotFound");
    expect(
      (
        await ws.contributor.request(
          "DELETE",
          `/crypto/transactions/${created.id}`,
        )
      ).status,
    ).toBe(204);
    expect(await ws.contributor.json("GET", "/crypto/transactions")).toEqual(
      [],
    );
  });
});

describe("crypto prices", () => {
  test("nothing until fetched; fetching asks for the traded coins and keeps them", async () => {
    const source = fakePrices({ BTC: 91000.5, ETH: 3100, DOGE: 0.15 });
    const ws = await setupWorkspace(db, {
      prices: source.source,
      now: fakeClock().now,
    });

    expect(await ws.viewer.json<CoinPrices>("GET", "/crypto/prices")).toEqual({
      prices: {},
      fetchedAt: null,
    });
    expect(source.calls).toEqual([]);

    await ws.admin.json("PUT", "/crypto/coins", { enabled: ["BTC", "ETH"] });
    // Anyone may fetch, viewers too.
    const fetched = await ws.viewer.json<CoinPrices>("POST", "/crypto/prices");
    expect(fetched).toEqual({
      prices: { BTC: 91000.5, ETH: 3100 },
      fetchedAt: "2026-03-15T12:00:00.000Z",
    });
    expect(source.calls).toEqual([["BTC", "ETH"]]);

    // Everyone in the workspace sees the stored prices without a new call.
    expect(await ws.other.json<CoinPrices>("GET", "/crypto/prices")).toEqual(
      fetched,
    );
    expect(source.calls).toHaveLength(1);
  });

  test("a minute after the last fetch, prices are fetched again; until then not", async () => {
    const source = fakePrices({ BTC: 1, ETH: 2, DOGE: 3 });
    const clock = fakeClock();
    const ws = await setupWorkspace(db, {
      prices: source.source,
      now: clock.now,
    });
    await ws.admin.json("PUT", "/crypto/coins", { enabled: ["BTC"] });

    await ws.contributor.json("POST", "/crypto/prices");
    clock.advance(30_000);
    const again = await ws.contributor.json<CoinPrices>(
      "POST",
      "/crypto/prices",
    );
    expect(source.calls).toHaveLength(1);
    expect(again.fetchedAt).toBe("2026-03-15T12:00:00.000Z");

    clock.advance(30_000);
    const later = await ws.contributor.json<CoinPrices>(
      "POST",
      "/crypto/prices",
    );
    expect(source.calls).toHaveLength(2);
    expect(later.fetchedAt).toBe("2026-03-15T12:01:00.000Z");
  });

  test("a newly traded coin without a price is fetched at once; turned-off coins keep their price", async () => {
    const source = fakePrices({ BTC: 1, ETH: 2 });
    const ws = await setupWorkspace(db, { prices: source.source });
    await ws.admin.json("PUT", "/crypto/coins", { enabled: ["BTC"] });
    await ws.admin.json("POST", "/crypto/prices");

    await ws.admin.json("PUT", "/crypto/coins", { enabled: ["ETH"] });
    const prices = await ws.admin.json<CoinPrices>("POST", "/crypto/prices");
    expect(source.calls).toEqual([["BTC"], ["ETH"]]);
    expect(prices.prices).toEqual({ BTC: 1, ETH: 2 });
  });

  test("logged-out visitors get nothing", async () => {
    const app = createTestApp({ db });
    expect(
      (await new Browser(app).request("GET", "/crypto/prices")).status,
    ).toBe(401);
    expect(
      (await new Browser(app).request("POST", "/crypto/prices")).status,
    ).toBe(401);
  });
});
