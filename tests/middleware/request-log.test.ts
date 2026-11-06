import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { requestContext } from "@/middleware/request-context";
import { requestLog } from "@/middleware/request-log";
import { createTestLog } from "@tests/helpers/log";

const LEVEL = { info: 30, warn: 40, error: 50 } as const;

function setup() {
  const { log, entries } = createTestLog();
  const app = new Hono()
    .use(requestContext(log))
    .use(requestLog())
    .get("/ok", (c) => c.text("ok"))
    .get("/bad", (c) => c.text("bad", 400))
    .get("/fail", (c) => c.text("fail", 503));
  return { app, entries };
}

describe("requestLog", () => {
  test("logs request details at info level for successful responses", async () => {
    const { app, entries } = setup();

    await app.request("/ok", { headers: { "X-Request-Id": "req-1" } });

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      level: LEVEL.info,
      msg: "request completed",
      requestId: "req-1",
      method: "GET",
      path: "/ok",
      status: 200,
    });
    expect(entries[0]?.durationMs).toBeNumber();
  });

  test("logs 4xx responses at warn level", async () => {
    const { app, entries } = setup();
    await app.request("/bad");
    expect(entries[0]).toMatchObject({ level: LEVEL.warn, status: 400 });
  });

  test("logs 5xx responses at error level", async () => {
    const { app, entries } = setup();
    await app.request("/fail");
    expect(entries[0]).toMatchObject({ level: LEVEL.error, status: 503 });
  });
});
