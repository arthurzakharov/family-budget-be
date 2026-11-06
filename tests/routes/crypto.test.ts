import { beforeAll, describe, expect, test } from "bun:test";
import type { Db } from "@/db/client";
import type { CryptoTransaction, ErrorResponse } from "@/types/responses";
import { setupWorkspace } from "@tests/helpers/api";
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
