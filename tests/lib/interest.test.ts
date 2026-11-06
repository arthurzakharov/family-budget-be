import { describe, expect, test } from "bun:test";
import { calculateInterest, forGroups } from "@/lib/interest";

// 365,000.00 € at 1% earns exactly 10.00 € (1000 cents) a day.
const rates = [{ ratePercent: 1, from: null, till: null }];
const deposit = (
  groupId: string,
  amountCents: number,
  date = "2026-01-01",
) => ({
  groupId,
  type: "deposit" as const,
  date,
  amountCents,
});

describe("calculateInterest", () => {
  test("pays out monthly with tax, split between groups by what they earned", () => {
    const summary = calculateInterest({
      transactions: [deposit("g1", 27_375_000), deposit("g2", 9_125_000)],
      rates,
      today: "2026-02-01",
      groupIds: ["g1", "g2", "g3"],
    });

    // 31 days × 1000 cents; tax: 25% = 7750, plus 5.5% of that = 426.25 → 426.
    expect(summary.payouts).toEqual([
      {
        date: "2026-02-01",
        gross: 31_000,
        tax: 8_176,
        net: 22_824,
        grossByGroup: { g1: 23_250, g2: 7_750, g3: 0 },
        taxByGroup: { g1: 6_132, g2: 2_044, g3: 0 },
        netByGroup: { g1: 17_118, g2: 5_706, g3: 0 },
        balance: 36_522_824,
        balanceByGroup: { g1: 27_392_118, g2: 9_130_706, g3: 0 },
      },
    ]);
    expect(summary).toMatchObject({
      balance: 36_522_824,
      gross: 31_000,
      tax: 8_176,
      net: 22_824,
      pending: 0,
    });
    expect(summary.byGroup.g1).toEqual({
      added: 27_375_000,
      gross: 23_250,
      tax: 6_132,
      net: 17_118,
      balance: 27_392_118,
      pending: 0,
    });
    expect(summary.byGroup.g3).toEqual({
      added: 0,
      gross: 0,
      tax: 0,
      net: 0,
      balance: 0,
      pending: 0,
    });
  });

  test("keeps interest pending until the 1st, and today's is not earned yet", () => {
    const summary = calculateInterest({
      transactions: [deposit("g1", 36_500_000)],
      rates,
      today: "2026-01-04",
    });

    expect(summary.payouts).toEqual([]);
    expect(summary.pending).toBeCloseTo(3_000);
    expect(summary.byGroup.g1!.pending).toBeCloseTo(3_000);
  });

  test("withdrawals reduce the balance and negative balances earn nothing", () => {
    const summary = calculateInterest({
      transactions: [
        deposit("g1", 36_500_000),
        {
          groupId: "g2",
          type: "withdrawal",
          date: "2026-01-01",
          amountCents: 1_000_000,
        },
      ],
      rates,
      today: "2026-02-01",
    });

    expect(summary.byGroup.g2).toMatchObject({ added: -1_000_000, gross: 0 });
    expect(summary.byGroup.g1!.gross).toBe(summary.gross);
  });

  test("days without a rate earn nothing and less than a cent is not paid out", () => {
    const summary = calculateInterest({
      transactions: [deposit("g1", 100)],
      rates: [{ ratePercent: 1, from: "2026-01-10", till: "2026-01-20" }],
      today: "2026-03-01",
    });

    expect(summary.payouts).toEqual([]);
    expect(summary.pending).toBeCloseTo((100 * 0.01 * 11) / 365);
  });

  test("is empty without transactions", () => {
    expect(
      calculateInterest({ transactions: [], rates, today: "2026-01-01" }),
    ).toEqual({
      balance: 0,
      payouts: [],
      gross: 0,
      tax: 0,
      net: 0,
      pending: 0,
      byGroup: {},
    });
  });
});

describe("forGroups", () => {
  test("narrows to some groups and drops payouts they earned nothing in", () => {
    const all = calculateInterest({
      transactions: [
        deposit("g1", 27_375_000),
        deposit("g2", 9_125_000, "2026-02-01"),
      ],
      rates,
      today: "2026-03-01",
      groupIds: ["g1", "g2"],
    });

    const g2 = forGroups(all, ["g2", "unknown"]);

    expect(all.payouts).toHaveLength(2);
    expect(g2.payouts.map((p) => p.date)).toEqual(["2026-03-01"]);
    expect(Object.keys(g2.byGroup)).toEqual(["g2"]);
    expect(g2.payouts[0]!.grossByGroup).toEqual({
      g2: all.payouts[1]!.grossByGroup.g2!,
    });
    expect(g2).toMatchObject({
      balance: all.byGroup.g2!.balance,
      gross: all.byGroup.g2!.gross,
      tax: all.byGroup.g2!.tax,
      net: all.byGroup.g2!.net,
    });
  });
});
