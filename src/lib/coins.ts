import type { CoinSymbol } from "@/types/responses";

/** The coins the admin can choose from, by market capitalisation. */
export const COINS = [
  "BTC",
  "ETH",
  "USDT",
  "XRP",
  "BNB",
  "SOL",
  "USDC",
  "DOGE",
  "TRX",
  "ADA",
  "LINK",
  "XLM",
  "SUI",
  "BCH",
  "AVAX",
  "HBAR",
  "LTC",
  "TON",
  "SHIB",
  "DOT",
] as const satisfies readonly CoinSymbol[];

/** Traded until the admin picks others: the five largest coins that are not stablecoins. */
export const DEFAULT_COINS: CoinSymbol[] = ["BTC", "ETH", "XRP", "BNB", "SOL"];

/** The coins a workspace trades; `enabled` is `null` until the admin picks. */
export function enabledCoins(enabled: string[] | null): CoinSymbol[] {
  return enabled === null
    ? DEFAULT_COINS
    : COINS.filter((coin) => enabled.includes(coin));
}
