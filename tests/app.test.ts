import { describe, expect, test } from "bun:test";
import { createApp } from "@/app";
import { appFixture } from "@tests/helpers/fixtures";
import { createTestLog } from "@tests/helpers/log";

describe("app", () => {
  test("returns JSON 404 for unknown routes", async () => {
    const { log } = createTestLog();
    const app = createApp({
      ...appFixture,
      log,
      commitInfo: null,
      origin: [],
    });

    const res = await app.request("/does-not-exist");

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: "Not Found",
      requestId: res.headers.get("X-Request-Id"),
    });
  });

  test("returns JSON 500 and logs unhandled errors", async () => {
    const { log, entries } = createTestLog();
    const app = createApp({
      ...appFixture,
      log,
      commitInfo: null,
      origin: [],
    });
    app.get("/boom", () => {
      throw new Error("kaboom");
    });

    const res = await app.request("/boom");

    const requestId = res.headers.get("X-Request-Id");
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: "Internal Server Error",
      requestId,
    });
    const errorLog = entries.find((e) => e.msg === "unhandled error");
    expect(errorLog).toMatchObject({ err: { message: "kaboom" }, requestId });
  });

  test("sets an X-Request-Id header and honours an incoming one", async () => {
    const { log } = createTestLog();
    const app = createApp({
      ...appFixture,
      log,
      commitInfo: null,
      origin: [],
    });

    const generated = await app.request("/health");
    const forwarded = await app.request("/health", {
      headers: { "X-Request-Id": "abc-123" },
    });

    expect(generated.headers.get("X-Request-Id")).toBeString();
    expect(forwarded.headers.get("X-Request-Id")).toBe("abc-123");
  });
});

describe("security headers", () => {
  test("sets secure defaults on every response", async () => {
    const { log } = createTestLog();
    const app = createApp({
      ...appFixture,
      log,
      commitInfo: null,
      origin: [],
    });

    const res = await app.request("/health");

    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("X-Frame-Options")).toBe("SAMEORIGIN");
    expect(res.headers.get("Strict-Transport-Security")).toStartWith(
      "max-age=",
    );
  });
});

describe("CORS", () => {
  const origin = "https://app.example.com";

  test("allows configured origins and exposes X-Request-Id", async () => {
    const { log } = createTestLog();
    const app = createApp({
      ...appFixture,
      log,
      commitInfo: null,
      origin: [origin],
    });

    const res = await app.request("/health", { headers: { Origin: origin } });

    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(origin);
    expect(res.headers.get("Access-Control-Expose-Headers")).toBe(
      "X-Request-Id",
    );
  });

  test("answers preflight requests for configured origins", async () => {
    const { log } = createTestLog();
    const app = createApp({
      ...appFixture,
      log,
      commitInfo: null,
      origin: [origin],
    });

    const res = await app.request("/health", {
      method: "OPTIONS",
      headers: { Origin: origin, "Access-Control-Request-Method": "PATCH" },
    });

    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(origin);
  });

  test("does not allow unknown origins", async () => {
    const { log } = createTestLog();
    const app = createApp({
      ...appFixture,
      log,
      commitInfo: null,
      origin: [origin],
    });

    const res = await app.request("/health", {
      headers: { Origin: "https://evil.example.com" },
    });

    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});
