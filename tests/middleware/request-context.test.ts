import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import {
  getRequestId,
  getRequestLog,
  getRequestSignal,
} from "@/contexts/request";
import { requestContext } from "@/middleware/request-context";
import type { AppEnv } from "@/types/app-env";
import { createTestLog } from "@tests/helpers/log";

function setup() {
  const { log, entries } = createTestLog();
  const app = new Hono<AppEnv>()
    .use(requestContext(log))
    .get("/id", (c) => c.text(getRequestId()))
    .get("/log", async (c) => {
      await Bun.sleep(1);
      getRequestLog().info("from context");
      c.get("log").info("from c.var");
      return c.text(c.get("requestId"));
    })
    .get("/signal", (c) =>
      c.text(String(getRequestSignal() === c.req.raw.signal)),
    )
    .get("/fail", () => {
      throw new Error("kaboom");
    })
    .onError((_err, c) => c.text(getRequestId(), 500));
  return { app, entries };
}

describe("requestContext", () => {
  test("reuses a well-formed incoming request id and echoes it", async () => {
    const { app } = setup();

    const res = await app.request("/id", {
      headers: { "X-Request-Id": "abc-123" },
    });

    expect(await res.text()).toBe("abc-123");
    expect(res.headers.get("X-Request-Id")).toBe("abc-123");
  });

  for (const [label, incoming] of [
    ["missing", undefined],
    ["malformed", "bad id!"],
    ["too long", "a".repeat(256)],
  ] as const) {
    test(`generates a request id when the incoming one is ${label}`, async () => {
      const { app } = setup();

      const res = await app.request("/id", {
        headers: incoming ? { "X-Request-Id": incoming } : {},
      });

      const id = await res.text();
      expect(id).toMatch(/^[0-9a-f-]{36}$/);
      expect(res.headers.get("X-Request-Id")).toBe(id);
    });
  }

  test("binds the log to the request id, across awaits and on c.var", async () => {
    const { app, entries } = setup();

    const res = await app.request("/log", {
      headers: { "X-Request-Id": "req-1" },
    });

    expect(await res.text()).toBe("req-1");
    expect(entries).toMatchObject([
      { msg: "from context", requestId: "req-1" },
      { msg: "from c.var", requestId: "req-1" },
    ]);
  });

  test("exposes the client abort signal", async () => {
    const { app } = setup();

    const res = await app.request("/signal");

    expect(await res.text()).toBe("true");
  });

  test("covers onError, so error responses can read the context", async () => {
    const { app } = setup();

    const res = await app.request("/fail", {
      headers: { "X-Request-Id": "req-1" },
    });

    expect(res.status).toBe(500);
    expect(await res.text()).toBe("req-1");
    expect(res.headers.get("X-Request-Id")).toBe("req-1");
  });

  test("getters throw outside a request", () => {
    for (const getter of [getRequestLog, getRequestId, getRequestSignal]) {
      expect(getter).toThrow("request context accessed outside of a request");
    }
  });
});
