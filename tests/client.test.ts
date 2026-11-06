import { describe, expect, test } from "bun:test";
import { createApp } from "@/app";
import { createFamilyBudgetClient } from "@/client";
import { appFixture, commitInfoFixture } from "@tests/helpers/fixtures";
import { createTestLog } from "@tests/helpers/log";

describe("createFamilyBudgetClient", () => {
  test("calls the API with typed routes", async () => {
    const { log } = createTestLog();
    const app = createApp({
      ...appFixture,
      log,
      commitInfo: commitInfoFixture,
      origin: [],
    });
    const client = createFamilyBudgetClient("http://family-budget-be.test", {
      fetch: (input: string | URL | Request, init?: RequestInit) =>
        app.request(input, init),
    });

    const res = await client.health.$get();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      status: "ok",
      commit: {
        shortHash: commitInfoFixture.shortHash,
        date: commitInfoFixture.date,
      },
    });
  });
});
