import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import {
  ApiError,
  HttpAbortedError,
  HttpError,
  HttpNetworkError,
  HttpTimeoutError,
  UnexpectedResponseError,
  ValidationError,
} from "@/errors";
import { HTTPException } from "hono/http-exception";
import { errorHandler } from "@/middleware/error-handler";
import { requestContext } from "@/middleware/request-context";
import { createTestLog } from "@tests/helpers/log";

function setup(error: Error) {
  const { log, entries } = createTestLog();
  const app = new Hono()
    .use(requestContext(log))
    .get("/fail", () => {
      throw error;
    })
    .onError(errorHandler());
  const request = async (): Promise<Response> =>
    app.request("/fail", { headers: { "X-Request-Id": "req-1" } });
  return { request, entries };
}

describe("errorHandler", () => {
  test("answers validation errors with 400 and the issues, without logging", async () => {
    const issues = [{ path: "json.name", message: "Required" }];
    const { request, entries } = setup(new ValidationError(issues));

    const res = await request();

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "Bad Request",
      code: "Required",
      requestId: "req-1",
      issues,
    });
    expect(entries).toHaveLength(0);
  });

  test("answers client disconnects with 499 and logs at info", async () => {
    const { request, entries } = setup(
      new HttpAbortedError(new DOMException("aborted", "AbortError")),
    );

    const res = await request();

    expect(res.status).toBe(499);
    expect(await res.json()).toEqual({
      error: "Client Closed Request",
      requestId: "req-1",
    });
    expect(entries[0]).toMatchObject({
      level: 30,
      msg: "client closed request",
      requestId: "req-1",
    });
  });

  test("answers upstream timeouts with 504", async () => {
    const { request, entries } = setup(
      new HttpTimeoutError(new DOMException("timed out", "TimeoutError")),
    );

    const res = await request();

    expect(res.status).toBe(504);
    expect(await res.json()).toEqual({
      error: "Gateway Timeout",
      requestId: "req-1",
    });
    expect(entries[0]).toMatchObject({
      level: 40,
      msg: "upstream request timed out",
      requestId: "req-1",
    });
  });

  for (const error of [
    new HttpError(503, new Headers(), "maintenance"),
    new HttpNetworkError(new Error("connection refused")),
    new UnexpectedResponseError(new Error("bad shape")),
  ]) {
    test(`answers ${error.name} with 502 and logs the upstream details`, async () => {
      const { request, entries } = setup(error);

      const res = await request();

      expect(res.status).toBe(502);
      expect(await res.json()).toEqual({
        error: "Bad Gateway",
        requestId: "req-1",
      });
      expect(entries[0]).toMatchObject({
        level: 40,
        msg: "upstream request failed",
        requestId: "req-1",
        err: { type: error.name },
      });
    });
  }

  test("logs the upstream status of HttpError but never its body or headers", async () => {
    const { request, entries } = setup(
      new HttpError(
        503,
        new Headers({ "Set-Cookie": "session=s-secret" }),
        '{"client":"Jane Doe"}',
      ),
    );

    await request();

    expect(entries[0]?.err).toMatchObject({ status: 503 });
    const logged = JSON.stringify(entries);
    expect(logged).not.toContain("Jane Doe");
    expect(logged).not.toContain("s-secret");
  });

  test("answers passthrough HttpErrors with the upstream status and a generic message", async () => {
    const { request, entries } = setup(
      new HttpError(404, new Headers(), '{"client":"Jane Doe"}', true),
    );

    const res = await request();

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: "Not Found",
      requestId: "req-1",
    });
    expect(entries).toHaveLength(0);
  });

  test("falls back to a generic message for unknown passthrough statuses", async () => {
    const { request } = setup(new HttpError(499, new Headers(), "", true));

    const res = await request();

    expect(res.status).toBe(499);
    expect(await res.json()).toEqual({
      error: "Upstream Error",
      requestId: "req-1",
    });
  });

  test("answers other errors with 500", async () => {
    const { request, entries } = setup(new Error("kaboom"));

    const res = await request();

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: "Internal Server Error",
      requestId: "req-1",
    });
    expect(entries[0]).toMatchObject({
      level: 50,
      msg: "unhandled error",
      err: { message: "kaboom" },
    });
  });
});

describe("errorHandler for expected failures", () => {
  test("answers ApiError with its status and code, without logging", async () => {
    const { request, entries } = setup(
      new ApiError(404, "errors.groupNotFound"),
    );

    const res = await request();

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: "Not Found",
      code: "errors.groupNotFound",
      requestId: "req-1",
    });
    expect(entries).toHaveLength(0);
  });

  test("answers Hono's HTTPException with its status", async () => {
    const { request } = setup(new HTTPException(403));

    const res = await request();

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: "Forbidden",
      requestId: "req-1",
    });
  });
});
