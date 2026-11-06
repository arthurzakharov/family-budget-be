export type PublicCommitInfo = {
  shortHash: string;
  date: string;
};

export type ValidationIssue = {
  path: string;
  message: string;
};

export type ErrorResponse = {
  /** HTTP status text, e.g. `Not Found`. */
  error: string;
  /**
   * Translation key for the frontend (e.g. `errors.groupNotFound`); set on
   * expected failures and on validation errors (the first issue's message).
   */
  code?: string;
  requestId: string;
  issues?: ValidationIssue[];
};

export type HealthResponse = {
  status: "ok";
  commit: PublicCommitInfo | null;
};

/**
 * admin: the workspace's creator, its only admin. Manages users, groups,
 *        coins and categories and fixes records, but never belongs to a group
 *        or has records under their own name.
 * contributor: adds and changes records.
 * viewer: can only look.
 */
export type Role = "admin" | "contributor" | "viewer";

/** A user as the frontend sees it: never includes the password hash. */
export type PublicUser = {
  id: string;
  name: string;
  role: Role;
  groupIds: string[];
};

/** What every logged-in user may know about the others. */
export type Member = Pick<PublicUser, "id" | "name" | "role">;

/** Logging in happens in two steps: unlock the workspace, then pick a user. */
export type AuthStatus =
  /** Nobody is logged in. */
  | { stage: "none" }
  /** The workspace is unlocked; a user still has to be picked. */
  | { stage: "workspace"; users: Pick<PublicUser, "id" | "name">[] }
  | { stage: "user"; user: PublicUser };

/** Who money belongs to, e.g. "Family" or "Father". */
export type Group = {
  id: string;
  name: string;
};

/** Fields every group record has. */
type GroupRecord = {
  id: string;
  /** The user it was added under; `null` once that user is deleted. */
  userId: string | null;
  /** The group the money belongs to. */
  groupId: string;
  /** `YYYY-MM-DD` */
  date: string;
};

export type DepositTransactionType = "deposit" | "withdrawal";

/** Money put into or taken out of the deposit. */
export type DepositTransaction = GroupRecord & {
  type: DepositTransactionType;
  /** Positive, in euro cents. */
  amountCents: number;
};

/** The deposit's yearly interest rate over a period. */
export type DepositRate = {
  id: string;
  userId: string | null;
  /** Percent per year, 0–100 (e.g. `2.25`). */
  ratePercent: number;
  /** `null` means "from the beginning". */
  from: string | null;
  /** `null` means "till now". */
  till: string | null;
};

/** Amounts in euro cents, keyed by group id. */
export type PerGroup = Record<string, number>;

/** Interest paid out on the 1st of a month. All amounts in euro cents. */
export type Payout = {
  date: string;
  gross: number;
  tax: number;
  net: number;
  grossByGroup: PerGroup;
  taxByGroup: PerGroup;
  netByGroup: PerGroup;
  /** Balance right after the payout, in total and per group. */
  balance: number;
  balanceByGroup: PerGroup;
};

/** One group's share of the deposit. All amounts in euro cents. */
export type GroupInterestSummary = {
  /** Deposits minus withdrawals. */
  added: number;
  gross: number;
  tax: number;
  net: number;
  /** Added money plus interest paid out (after tax). */
  balance: number;
  /** Interest earned but not paid out yet, before tax. */
  pending: number;
};

/** The deposit's balance and interest. All amounts in euro cents. */
export type InterestSummary = {
  /** Deposits minus withdrawals plus interest paid out (after tax). */
  balance: number;
  payouts: Payout[];
  gross: number;
  tax: number;
  net: number;
  /** Interest earned since the last payout, before tax, paid on the next 1st. */
  pending: number;
  byGroup: Record<string, GroupInterestSummary>;
};

/** The coins the admin can choose from (see `COINS` in the backend). */
export type CoinSymbol =
  | "BTC"
  | "ETH"
  | "USDT"
  | "XRP"
  | "BNB"
  | "SOL"
  | "USDC"
  | "DOGE"
  | "TRX"
  | "ADA"
  | "LINK"
  | "XLM"
  | "SUI"
  | "BCH"
  | "AVAX"
  | "HBAR"
  | "LTC"
  | "TON"
  | "SHIB"
  | "DOT";

export type CryptoTransactionType = "buy" | "sell";

/** A buy or sell of a coin. */
export type CryptoTransaction = GroupRecord & {
  coin: CoinSymbol;
  type: CryptoTransactionType;
  /** How many coins were bought or sold. */
  amount: number;
  /** Price of one coin at that moment, in euros. */
  price: number;
};

export type CategoryKind = "expense" | "income";

/** An expense or income category, built-in or created by the admin. */
export type Category = {
  id: string;
  kind: CategoryKind;
  /** `null` for built-in categories, whose name is a translation (`category.<id>`). */
  name: string | null;
  /** Hidden categories cannot be picked for new entries; old entries keep them. */
  hidden: boolean;
};

/** One expense or income; the category's kind gives the direction. */
export type ExpenseEntry = GroupRecord & {
  categoryId: string;
  /** Positive, in euro cents. */
  amountCents: number;
  /** Free text, e.g. "Dentist"; empty when not given. */
  note: string;
};
