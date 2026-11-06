import { expect, test } from "bun:test";
import { DEFAULT_COINS, enabledCoins } from "@/lib/coins";

test("enabled coins default until the admin picks, then follow the coin order", () => {
  expect(enabledCoins(null)).toEqual(DEFAULT_COINS);
  expect(enabledCoins(["SOL", "BTC", "GONE"])).toEqual(["BTC", "SOL"]);
  expect(enabledCoins([])).toEqual([]);
});
