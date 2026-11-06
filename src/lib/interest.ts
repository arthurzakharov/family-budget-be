/**
 * Deposit interest, worked out to the cent the way Trade Republic pays it.
 * All amounts are euro cents.
 */
import { nextDay } from "@/lib/dates";
import type {
  GroupInterestSummary,
  InterestSummary,
  Payout,
  PerGroup,
} from "@/types/responses";

/** German capital gains tax. Set to 0 while a tax-free allowance covers the interest. */
const CAPITAL_GAINS_TAX = 0.25;
/** Solidarity surcharge, a share of the capital gains tax. */
const SOLIDARITY_SURCHARGE = 0.055;

/** What `calculateInterest` needs of a transaction. */
type InterestTransaction = {
  groupId: string;
  type: "deposit" | "withdrawal";
  date: string;
  amountCents: number;
};

/** What `calculateInterest` needs of a rate period. */
type InterestRate = {
  ratePercent: number;
  from: string | null;
  till: string | null;
};

type CalculateInterestParams = {
  transactions: InterestTransaction[];
  rates: InterestRate[];
  /** Interest is earned up to (not including) this day, `YYYY-MM-DD`. */
  today: string;
  /** Groups to report even when they have no transactions yet. */
  groupIds?: string[] | undefined;
};

/** Capital gains tax is rounded to the cent; the surcharge drops fractions of a cent. */
function taxOn(gross: number): number {
  const capitalGains = Math.round(gross * CAPITAL_GAINS_TAX);
  const surcharge = Math.floor(capitalGains * SOLIDARITY_SURCHARGE + 1e-7);
  return capitalGains + surcharge;
}

/** The yearly rate (percent) on `date`, 0 when no period covers it. */
function rateOn(rates: InterestRate[], date: string): number {
  const period = rates.find(
    (r) =>
      (r.from === null || r.from <= date) &&
      (r.till === null || date <= r.till),
  );
  return period?.ratePercent ?? 0;
}

const signed = (t: InterestTransaction): number =>
  t.type === "withdrawal" ? -t.amountCents : t.amountCents;

/**
 * Splits whole cents by weight. The rounding difference goes to the key with
 * the largest weight, so the parts always add up to the total.
 */
function split(total: number, weights: PerGroup, keys: string[]): PerGroup {
  const sum = keys.reduce((s, k) => s + weights[k]!, 0);
  const parts: PerGroup = Object.fromEntries(
    keys.map((k) => [k, sum > 0 ? Math.round((total * weights[k]!) / sum) : 0]),
  );
  const largest = keys.reduce((a, b) => (weights[b]! > weights[a]! ? b : a));
  parts[largest] =
    parts[largest]! + total - keys.reduce((s, k) => s + parts[k]!, 0);
  return parts;
}

/**
 * Interest accrues daily on the balance at that day's yearly rate (rate / 365).
 * On the 1st of every month it is paid out, tax is withheld, and the rest is
 * added to the balance, so it compounds monthly. Each payout is split between
 * groups by how much interest their money earned, and each group's interest
 * stays in its balance. `pending` amounts keep fractions of a cent.
 */
export function calculateInterest({
  transactions,
  rates,
  today,
  groupIds = [],
}: CalculateInterestParams): InterestSummary {
  const byDate = new Map<string, InterestTransaction[]>();
  for (const t of transactions) {
    byDate.set(t.date, [...(byDate.get(t.date) ?? []), t]);
  }
  const keys = [
    ...new Set([...groupIds, ...transactions.map((t) => t.groupId)]),
  ];
  const zeros = (): PerGroup => Object.fromEntries(keys.map((k) => [k, 0]));
  const first = [...byDate.keys()].sort()[0];
  const payouts: Payout[] = [];
  const balances = zeros();
  const earned = zeros();
  const byGroup: Record<string, GroupInterestSummary> = Object.fromEntries(
    keys.map((k) => [
      k,
      { added: 0, gross: 0, tax: 0, net: 0, balance: 0, pending: 0 },
    ]),
  );
  let balance = 0;
  let pending = 0;

  for (let day = first; day && day <= today; day = nextDay(day)) {
    // Less than a cent is not paid out; it keeps accruing until the next 1st.
    if (day.endsWith("-01") && Math.round(pending) > 0) {
      const gross = Math.round(pending);
      const tax = taxOn(gross);
      const net = gross - tax;
      const grossByGroup = split(gross, earned, keys);
      const taxByGroup = split(tax, earned, keys);
      const netByGroup: PerGroup = Object.fromEntries(
        keys.map((k) => [k, grossByGroup[k]! - taxByGroup[k]!]),
      );
      for (const k of keys) {
        balances[k]! += netByGroup[k]!;
        byGroup[k]!.gross += grossByGroup[k]!;
        byGroup[k]!.tax += taxByGroup[k]!;
        byGroup[k]!.net += netByGroup[k]!;
        earned[k] = 0;
      }
      balance += net;
      payouts.push({
        date: day,
        gross,
        tax,
        net,
        grossByGroup,
        taxByGroup,
        netByGroup,
        balance,
        balanceByGroup: { ...balances },
      });
      pending = 0;
    }
    for (const t of byDate.get(day) ?? []) {
      balance += signed(t);
      balances[t.groupId]! += signed(t);
      byGroup[t.groupId]!.added += signed(t);
    }
    // Today's interest is not earned until the day is over.
    if (day < today) {
      const rate = rateOn(rates, day) / 100 / 365;
      pending += Math.max(balance, 0) * rate;
      for (const k of keys) earned[k]! += Math.max(balances[k]!, 0) * rate;
    }
  }

  for (const k of keys) {
    byGroup[k]!.balance = balances[k]!;
    byGroup[k]!.pending = earned[k]!;
  }
  const sum = (key: "gross" | "tax" | "net"): number =>
    payouts.reduce((s, p) => s + p[key], 0);
  return {
    balance,
    payouts,
    gross: sum("gross"),
    tax: sum("tax"),
    net: sum("net"),
    pending,
    byGroup,
  };
}

/**
 * The same summary narrowed to some groups: their share only, with totals
 * that add up their parts. Payouts the groups earned nothing in are left out.
 * Interest is always calculated for the whole deposit first, since tax is
 * withheld on the whole payout and then split, so narrowing happens afterwards.
 */
export function forGroups(
  summary: InterestSummary,
  groupIds: string[],
): InterestSummary {
  const keys = groupIds.filter((k) => summary.byGroup[k]);
  const pick = (values: PerGroup): PerGroup =>
    Object.fromEntries(keys.map((k) => [k, values[k]!]));
  const total = (values: PerGroup): number =>
    keys.reduce((s, k) => s + values[k]!, 0);
  const payouts = summary.payouts
    .map((p) => ({
      date: p.date,
      gross: total(p.grossByGroup),
      tax: total(p.taxByGroup),
      net: total(p.netByGroup),
      grossByGroup: pick(p.grossByGroup),
      taxByGroup: pick(p.taxByGroup),
      netByGroup: pick(p.netByGroup),
      balance: total(p.balanceByGroup),
      balanceByGroup: pick(p.balanceByGroup),
    }))
    .filter((p) => p.gross > 0);
  const byGroup = Object.fromEntries(keys.map((k) => [k, summary.byGroup[k]!]));
  const sum = (key: keyof GroupInterestSummary): number =>
    keys.reduce((s, k) => s + byGroup[k]![key], 0);
  return {
    balance: sum("balance"),
    payouts,
    gross: sum("gross"),
    tax: sum("tax"),
    net: sum("net"),
    pending: sum("pending"),
    byGroup,
  };
}
