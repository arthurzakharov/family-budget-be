import { hc, type ClientRequestOptions } from "hono/client";
import type { AppType } from "@/app";

export type * from "@/app";

export function createFamilyBudgetClient(
  baseUrl: string,
  options?: ClientRequestOptions,
) {
  return hc<AppType>(baseUrl, options);
}

export type FamilyBudgetClient = ReturnType<typeof createFamilyBudgetClient>;
