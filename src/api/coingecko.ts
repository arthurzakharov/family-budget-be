import { z } from "zod";
import { HttpClient } from "@/api/http-client";
import { COINGECKO_IDS } from "@/lib/coins";
import type { CoinSymbol } from "@/types/responses";

/** Current prices in euros; coins the source has no price for are left out. */
export type CoinPriceMap = Partial<Record<CoinSymbol, number>>;

/** Where current coin prices come from; injectable for tests. */
export type PriceSource = {
  eurPrices(coins: readonly CoinSymbol[]): Promise<CoinPriceMap>;
};

type CoinGeckoParams = {
  /**
   * Optional CoinGecko Demo API key. Without one the public API is used,
   * which has lower rate limits.
   */
  apiKey?: string | undefined;
  /** `fetch`-compatible function; injectable for tests. */
  fetch?: (url: string, init?: RequestInit) => Promise<Response>;
};

/** `/simple/price` answer: `{ bitcoin: { eur: 91234.5 }, ... }`. */
const simplePriceSchema = z.record(
  z.string(),
  z.object({ eur: z.number().optional() }),
);

/**
 * Coin prices from CoinGecko (`/simple/price`): one request for all asked
 * coins. Must run inside a request (it uses the request-bound `HttpClient`).
 */
export function createCoinGecko({
  apiKey,
  fetch,
}: CoinGeckoParams = {}): PriceSource {
  const http = new HttpClient({
    baseUrl: "https://api.coingecko.com/api/v3",
    headers: {
      Accept: "application/json",
      ...(apiKey && { "x-cg-demo-api-key": apiKey }),
    },
    ...(fetch && { fetch }),
  });

  return {
    async eurPrices(coins) {
      if (coins.length === 0) return {};
      const data = await http.get("/simple/price", simplePriceSchema, {
        query: {
          ids: coins.map((coin) => COINGECKO_IDS[coin]).join(","),
          vs_currencies: "eur",
        },
      });
      const prices: CoinPriceMap = {};
      for (const coin of coins) {
        const eur = data[COINGECKO_IDS[coin]]?.eur;
        if (eur !== undefined) prices[coin] = eur;
      }
      return prices;
    },
  };
}
