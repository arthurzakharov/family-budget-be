import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { notFound } from "@/middleware/not-found";
import { requestContext } from "@/middleware/request-context";
import { createTestLog } from "@tests/helpers/log";

function setup() {
  const { log } = createTestLog();
  return new Hono()
    .use(requestContext(log))
    .get("/known", (c) => c.text("ok"))
    .notFound(notFound());
}

describe("notFound", () => {
  test("answers unknown routes with JSON 404 and the request id", async () => {
    const res = await setup().request("/missing", {
      headers: { "X-Request-Id": "req-1" },
    });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: "Not Found",
      requestId: "req-1",
    });
  });

  test("does not affect known routes", async () => {
    const res = await setup().request("/known");

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });
});
