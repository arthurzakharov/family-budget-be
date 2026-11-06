import { describe, expect, test } from "bun:test";
import { testClient } from "hono/testing";
import { createApp } from "@/app";
import { appFixture, commitInfoFixture } from "@tests/helpers/fixtures";
import { createTestLog } from "@tests/helpers/log";

describe("health routes", () => {
  test("GET /health returns ok status with commit info", async () => {
    const { log } = createTestLog();
    const app = createApp({
      ...appFixture,
      log,
      commitInfo: commitInfoFixture,
      origin: [],
    });

    const res = await app.request("/health");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: "ok",
      commit: {
        shortHash: commitInfoFixture.shortHash,
        date: commitInfoFixture.date,
      },
    });
  });

  for (const [method, path] of [
    ["GET", "/"],
    ["POST", "/health"],
  ] as const) {
    test(`${method} ${path} is not found`, async () => {
      const { log } = createTestLog();
      const app = createApp({
        ...appFixture,
        log,
        commitInfo: commitInfoFixture,
        origin: [],
      });

      // A JSON request: CSRF protection rejects body-less cross-site POSTs.
      const res = await app.request(path, {
        method,
        headers: { "Content-Type": "application/json" },
      });

      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ error: "Not Found" });
    });
  }

  test("returns null commit when commit info is unavailable", async () => {
    const { log } = createTestLog();
    const app = createApp({
      ...appFixture,
      log,
      commitInfo: null,
      origin: [],
    });

    const res = await app.request("/health");

    expect(await res.json()).toEqual({ status: "ok", commit: null });
  });

  test("is callable through the typed RPC client", async () => {
    const { log } = createTestLog();
    const client = testClient(
      createApp({
        ...appFixture,
        log,
        commitInfo: commitInfoFixture,
        origin: [],
      }),
    );

    const res = await client.health.$get();
    const body = await res.json();

    expect(body.status).toBe("ok");
    expect(body.commit?.shortHash).toBe(commitInfoFixture.shortHash);
  });
});
