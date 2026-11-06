import { beforeAll, describe, expect, test } from "bun:test";
import type { Db } from "@/db/client";
import type {
  DepositRate,
  DepositTransaction,
  ErrorResponse,
  InterestSummary,
} from "@/types/responses";
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
  type: "deposit",
  date: "2026-01-01",
  amountCents: 36_500_000,
  ...over,
});

describe("deposit transactions", () => {
  test("users add transactions under their own name and see only their groups", async () => {
    const ws = await setupWorkspace(db);

    const mine = await ws.contributor.json<DepositTransaction>(
      "POST",
      "/deposit/transactions",
      tx(ws.g1.id, { userId: ws.users.other.id }),
      201,
    );
    await ws.other.json("POST", "/deposit/transactions", tx(ws.g2.id), 201);

    expect(mine).toEqual({
      id: expect.any(String),
      userId: ws.users.contributor.id,
      groupId: ws.g1.id,
      date: "2026-01-01",
      type: "deposit",
      amountCents: 36_500_000,
    });
    expect(await ws.viewer.json("GET", "/deposit/transactions")).toEqual([
      mine,
    ]);
    expect(
      await ws.admin.json<unknown[]>("GET", "/deposit/transactions"),
    ).toHaveLength(2);
  });

  test("viewers cannot add, and nobody adds to a group they are not in", async () => {
    const ws = await setupWorkspace(db);
    const other = await setupWorkspace(db);

    const viewer = await ws.viewer.request(
      "POST",
      "/deposit/transactions",
      tx(ws.g1.id),
    );
    expect(viewer.status).toBe(403);
    for (const groupId of [ws.g2.id, other.g1.id]) {
      const res = await ws.contributor.request(
        "POST",
        "/deposit/transactions",
        tx(groupId),
      );
      expect(await codeOf(res)).toBe("errors.group");
    }
  });

  test("validates the body with translation keys", async () => {
    const ws = await setupWorkspace(db);

    const cases: [object, string][] = [
      [{ groupId: "x" }, "errors.group"],
      [{ type: "gift" }, "errors.type"],
      [{ date: "2026-02-30" }, "errors.date"],
      [{ amountCents: 0 }, "errors.amount"],
      [{ amountCents: 1.5 }, "errors.amount"],
    ];
    for (const [over, code] of cases) {
      const res = await ws.contributor.request(
        "POST",
        "/deposit/transactions",
        tx(ws.g1.id, over),
      );
      expect(res.status).toBe(400);
      expect(await codeOf(res)).toBe(code);
    }
  });

  test("the admin adds under, and moves to, a non-admin user", async () => {
    const ws = await setupWorkspace(db);

    for (const userId of [undefined, ws.users.admin.id, crypto.randomUUID()]) {
      const res = await ws.admin.request(
        "POST",
        "/deposit/transactions",
        tx(ws.g1.id, { userId }),
      );
      expect(await codeOf(res)).toBe("errors.user");
    }
    const created = await ws.admin.json<DepositTransaction>(
      "POST",
      "/deposit/transactions",
      tx(ws.g2.id, { userId: ws.users.other.id }),
      201,
    );
    expect(created.userId).toBe(ws.users.other.id);

    const moved = await ws.admin.json<DepositTransaction>(
      "PUT",
      `/deposit/transactions/${created.id}`,
      tx(ws.g1.id, { userId: ws.users.contributor.id, amountCents: 5 }),
    );
    expect(moved).toMatchObject({
      userId: ws.users.contributor.id,
      groupId: ws.g1.id,
      amountCents: 5,
    });
  });

  test("editing keeps the user, deleting removes the transaction", async () => {
    const ws = await setupWorkspace(db);
    const created = await ws.contributor.json<DepositTransaction>(
      "POST",
      "/deposit/transactions",
      tx(ws.g1.id),
      201,
    );

    const edited = await ws.admin.json<DepositTransaction>(
      "PUT",
      `/deposit/transactions/${created.id}`,
      tx(ws.g1.id, { type: "withdrawal", userId: ws.users.contributor.id }),
    );
    const byContributor = await ws.contributor.json<DepositTransaction>(
      "PUT",
      `/deposit/transactions/${created.id}`,
      tx(ws.g1.id, { amountCents: 7 }),
    );
    expect(edited.type).toBe("withdrawal");
    expect(byContributor).toMatchObject({
      userId: ws.users.contributor.id,
      amountCents: 7,
    });

    const deleted = await ws.contributor.request(
      "DELETE",
      `/deposit/transactions/${created.id}`,
    );
    expect(deleted.status).toBe(204);
    expect(await ws.contributor.json("GET", "/deposit/transactions")).toEqual(
      [],
    );
  });

  test("transactions of other groups are not found", async () => {
    const ws = await setupWorkspace(db);
    const created = await ws.other.json<DepositTransaction>(
      "POST",
      "/deposit/transactions",
      tx(ws.g2.id),
      201,
    );

    for (const id of [created.id, "nope", crypto.randomUUID()]) {
      const put = await ws.contributor.request(
        "PUT",
        `/deposit/transactions/${id}`,
        tx(ws.g1.id),
      );
      const del = await ws.contributor.request(
        "DELETE",
        `/deposit/transactions/${id}`,
      );
      expect([put.status, del.status]).toEqual([404, 404]);
      expect(await codeOf(del)).toBe("errors.transactionNotFound");
    }
  });
});

describe("deposit rates", () => {
  test("periods are added, listed and edited without overlapping", async () => {
    const ws = await setupWorkspace(db);
    const first = await ws.contributor.json<DepositRate>(
      "POST",
      "/deposit/rates",
      { ratePercent: 4, from: null, till: "2025-12-31" },
      201,
    );
    const second = await ws.contributor.json<DepositRate>(
      "POST",
      "/deposit/rates",
      { ratePercent: 2.25, from: "2026-01-01", till: null },
      201,
    );

    expect(first).toEqual({
      id: expect.any(String),
      userId: ws.users.contributor.id,
      ratePercent: 4,
      from: null,
      till: "2025-12-31",
    });
    expect(await ws.viewer.json("GET", "/deposit/rates")).toEqual([
      first,
      second,
    ]);

    const overlap = await ws.contributor.request("POST", "/deposit/rates", {
      ratePercent: 1,
      from: "2025-06-01",
      till: "2025-06-30",
    });
    expect(await codeOf(overlap)).toBe("errors.overlap");
    // A period may overlap its own old dates.
    const edited = await ws.contributor.json<DepositRate>(
      "PUT",
      `/deposit/rates/${second.id}`,
      {
        ratePercent: 2,
        from: "2026-01-02",
        till: null,
      },
    );
    expect(edited).toMatchObject({ ratePercent: 2, from: "2026-01-02" });
    const moved = await ws.admin.json<DepositRate>(
      "PUT",
      `/deposit/rates/${second.id}`,
      {
        ratePercent: 2,
        from: "2026-01-02",
        till: null,
        userId: ws.users.other.id,
      },
    );
    expect(moved.userId).toBe(ws.users.other.id);
  });

  test("validates rates and periods", async () => {
    const ws = await setupWorkspace(db);

    const cases: [object, string][] = [
      [{ ratePercent: 101, from: null, till: null }, "errors.rate"],
      [{ ratePercent: 1, from: "x", till: null }, "errors.from"],
      [{ ratePercent: 1, from: null, till: "x" }, "errors.till"],
      [
        { ratePercent: 1, from: "2026-02-01", till: "2026-01-01" },
        "errors.fromAfterTill",
      ],
    ];
    for (const [body, code] of cases) {
      expect(
        await codeOf(
          await ws.contributor.request("POST", "/deposit/rates", body),
        ),
      ).toBe(code);
    }
    const viewer = await ws.viewer.request("POST", "/deposit/rates", {
      ratePercent: 1,
      from: null,
      till: null,
    });
    expect(viewer.status).toBe(403);
  });

  test("rates of other workspaces are not found", async () => {
    const ws = await setupWorkspace(db);
    const other = await setupWorkspace(db);
    const rate = await other.contributor.json<DepositRate>(
      "POST",
      "/deposit/rates",
      { ratePercent: 1, from: null, till: null },
      201,
    );

    for (const id of [rate.id, "nope"]) {
      const res = await ws.contributor.request("PUT", `/deposit/rates/${id}`, {
        ratePercent: 1,
        from: null,
        till: null,
      });
      expect(res.status).toBe(404);
      expect(await codeOf(res)).toBe("errors.rateNotFound");
    }
  });
});

describe("deposit interest", () => {
  test("is calculated on the whole deposit; users get their groups' share", async () => {
    const ws = await setupWorkspace(db);
    await ws.contributor.json(
      "POST",
      "/deposit/rates",
      { ratePercent: 1, from: null, till: null },
      201,
    );
    await ws.contributor.json(
      "POST",
      "/deposit/transactions",
      tx(ws.g1.id, { amountCents: 27_375_000 }),
      201,
    );
    await ws.other.json(
      "POST",
      "/deposit/transactions",
      tx(ws.g2.id, { amountCents: 9_125_000 }),
      201,
    );

    const all = await ws.admin.json<InterestSummary>(
      "GET",
      "/deposit/interest",
    );
    const mine = await ws.viewer.json<InterestSummary>(
      "GET",
      "/deposit/interest",
    );

    // Today is 2026-03-15 in tests: two payouts so far.
    expect(all.payouts.map((p) => p.date)).toEqual([
      "2026-02-01",
      "2026-03-01",
    ]);
    expect(all.payouts[0]).toMatchObject({
      gross: 31_000,
      tax: 8_176,
      net: 22_824,
    });
    expect(Object.keys(mine.byGroup)).toEqual([ws.g1.id]);
    expect(mine.payouts[0]).toMatchObject({
      gross: 23_250,
      tax: 6_132,
      net: 17_118,
    });
    expect(mine.balance).toBe(all.byGroup[ws.g1.id]!.balance);
  });
});
