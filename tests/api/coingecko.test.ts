import { expect, test } from "bun:test";
import { createCoinGecko } from "@/api/coingecko";
import { UnexpectedResponseError } from "@/errors";
import { runWithRequestContext } from "@/contexts/request";
import { createTestLog } from "@tests/helpers/log";

type Call = { url: string; headers: Headers };

/** Runs `fn` inside a request context, as the price source does during a request. */
function inRequest<T>(fn: () => Promise<T>): Promise<T> {
  const { log } = createTestLog();
  return runWithRequestContext(
    {
      log: log.child({ requestId: "req-1" }),
      requestId: "req-1",
      signal: new AbortController().signal,
    },
    fn,
  );
}

function setup(body: unknown, apiKey?: string) {
  const calls: Call[] = [];
  const source = createCoinGecko({
    apiKey,
    fetch: async (url, init) => {
      calls.push({ url, headers: new Headers(init?.headers) });
      return Response.json(body);
    },
  });
  return { source, calls };
}

test("asks for all coins in one request and returns euro prices by symbol", async () => {
  const { source, calls } = setup({
    bitcoin: { eur: 91000.5 },
    "avalanche-2": { eur: 20.1 },
  });

  const prices = await inRequest(() =>
    source.eurPrices(["BTC", "AVAX", "DOT"]),
  );

  // A coin the API has no price for is left out.
  expect(prices).toEqual({ BTC: 91000.5, AVAX: 20.1 });
  expect(calls).toHaveLength(1);
  const url = new URL(calls[0]!.url);
  expect(url.origin + url.pathname).toBe(
    "https://api.coingecko.com/api/v3/simple/price",
  );
  expect(url.searchParams.get("ids")).toBe("bitcoin,avalanche-2,polkadot");
  expect(url.searchParams.get("vs_currencies")).toBe("eur");
  expect(calls[0]!.headers.has("x-cg-demo-api-key")).toBe(false);
});

test("sends the Demo API key when given", async () => {
  const { source, calls } = setup({ bitcoin: { eur: 1 } }, "demo-key");
  await inRequest(() => source.eurPrices(["BTC"]));
  expect(calls[0]!.headers.get("x-cg-demo-api-key")).toBe("demo-key");
});

test("no coins, no request", async () => {
  const { source, calls } = setup({});
  expect(await inRequest(() => source.eurPrices([]))).toEqual({});
  expect(calls).toHaveLength(0);
});

test("an answer of an unexpected shape is an error", async () => {
  const { source } = setup({ bitcoin: { eur: "a lot" } });
  const error: unknown = await inRequest(() => source.eurPrices(["BTC"])).catch(
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(UnexpectedResponseError);
});
