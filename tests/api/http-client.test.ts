import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { HttpClient } from "@/api/http-client";
import {
  HttpAbortedError,
  HttpClientError,
  HttpError,
  HttpNetworkError,
  HttpTimeoutError,
  UnexpectedResponseError,
} from "@/errors";
import { runWithRequestContext, type RequestContext } from "@/contexts/request";
import { createTestLog, type LogEntry } from "@tests/helpers/log";

const itemSchema = z.object({ id: z.number() });

type FetchCall = { url: string; init?: RequestInit | undefined };

/** Wraps `client` so every method call runs inside `context`, as it would during a request. */
function inRequest(client: HttpClient, context: RequestContext): HttpClient {
  return new Proxy(client, {
    get(target, prop) {
      const value: unknown = Reflect.get(target, prop);
      return typeof value === "function"
        ? (...args: unknown[]) =>
            runWithRequestContext(context, () => value.apply(target, args))
        : value;
    },
  });
}

function createContext(): RequestContext & { entries: LogEntry[] } {
  const { log, entries } = createTestLog();
  return {
    log: log.child({ requestId: "req-1" }),
    requestId: "req-1",
    signal: new AbortController().signal,
    entries,
  };
}

/** A fetch that never settles on its own, only when its signal aborts. */
const hangingFetch = (_url: string, init?: RequestInit): Promise<Response> =>
  new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
  });

function setup(response: () => Response | Promise<Response>) {
  const calls: FetchCall[] = [];
  const client = new HttpClient({
    baseUrl: "https://api.example.com",
    headers: { Authorization: "Bearer secret" },
    fetch: async (url, init) => {
      calls.push({ url, init });
      return response();
    },
  });
  const context = createContext();
  const http = inRequest(client, context);
  const headers = (i = 0): Headers => new Headers(calls[i]?.init?.headers);
  return { http, client, calls, entries: context.entries, headers };
}

describe("HttpClient", () => {
  test("GET joins the base URL, sends default headers and parses the body", async () => {
    const { http, calls, headers } = setup(() => Response.json({ id: 1 }));

    expect(await http.get("/items/1", itemSchema)).toEqual({ id: 1 });
    expect(calls[0]?.url).toBe("https://api.example.com/items/1");
    expect(calls[0]?.init?.method).toBe("GET");
    expect(calls[0]?.init?.body).toBeUndefined();
    expect(headers().get("Authorization")).toBe("Bearer secret");
    expect(headers().has("Content-Type")).toBe(false);
    expect(calls[0]?.init?.signal).toBeInstanceOf(AbortSignal);
  });

  for (const method of ["post", "put", "patch"] as const) {
    test(`${method.toUpperCase()} sends a JSON body alongside the default headers`, async () => {
      const { http, calls, headers } = setup(() => Response.json({ id: 2 }));

      expect(await http[method]("/items", { name: "new" }, itemSchema)).toEqual(
        { id: 2 },
      );
      expect(calls[0]?.init?.method).toBe(method.toUpperCase());
      expect(calls[0]?.init?.body).toBe('{"name":"new"}');
      expect(headers().get("Content-Type")).toBe("application/json");
      expect(headers().get("Authorization")).toBe("Bearer secret");
    });
  }

  test("DELETE sends no body", async () => {
    const { http, calls } = setup(() => new Response(null, { status: 204 }));

    await http.delete("/items/1", z.undefined());

    expect(calls[0]?.init?.method).toBe("DELETE");
    expect(calls[0]?.init?.body).toBeUndefined();
  });

  test("passes an empty body to the schema as undefined", async () => {
    const { http } = setup(() => new Response(null, { status: 204 }));

    expect(await http.post("/items/1/archive", {}, z.undefined())).toBe(
      undefined,
    );
  });

  test("appends query parameters and skips undefined values", async () => {
    const { http, calls } = setup(() => Response.json({ id: 1 }));

    await http.get("/items", itemSchema, {
      query: { page: 2, active: true, q: "a b&c", missing: undefined },
    });
    await http.get("/items?sort=name", itemSchema, { query: { page: 1 } });

    expect(calls[0]?.url).toBe(
      "https://api.example.com/items?page=2&active=true&q=a+b%26c",
    );
    expect(calls[1]?.url).toBe(
      "https://api.example.com/items?sort=name&page=1",
    );
  });

  test("merges per-request headers over the defaults", async () => {
    const { http, headers } = setup(() => Response.json({ id: 1 }));

    await http.post("/items", {}, itemSchema, {
      headers: { "Idempotency-Key": "k-1", Authorization: "Bearer other" },
    });

    expect(headers().get("Idempotency-Key")).toBe("k-1");
    expect(headers().get("Authorization")).toBe("Bearer other");
  });

  test("throws HttpError with status, headers and the response body for non-2xx responses", async () => {
    const { http } = setup(
      () =>
        new Response('{"message":"transaction not found"}', {
          status: 404,
          headers: { "x-request": "1" },
        }),
    );

    const error = await http.get("/items/1", itemSchema).catch((e) => e);

    expect(error).toBeInstanceOf(HttpError);
    expect(error.status).toBe(404);
    expect(error.headers.get("x-request")).toBe("1");
    expect(error.body).toBe('{"message":"transaction not found"}');
  });

  test("marks listed upstream statuses for passthrough", async () => {
    const { http } = setup(() => new Response("missing", { status: 404 }));

    const listed = await http
      .get("/items/1", itemSchema, { passthrough: [404, 422] })
      .catch((e) => e);
    const unlisted = await http
      .get("/items/1", itemSchema, { passthrough: [422] })
      .catch((e) => e);
    const none = await http.get("/items/1", itemSchema).catch((e) => e);

    expect(listed.passthrough).toBe(true);
    expect(unlisted.passthrough).toBe(false);
    expect(none.passthrough).toBe(false);
  });

  test("throws UnexpectedResponseError when the body does not match the schema", async () => {
    const { http } = setup(() => Response.json({ id: "not a number" }));

    const error = await http.get("/items/1", itemSchema).catch((e) => e);

    expect(error).toBeInstanceOf(UnexpectedResponseError);
    expect(error.cause).toBeInstanceOf(z.ZodError);
  });

  test("throws UnexpectedResponseError when the body is not JSON", async () => {
    const { http } = setup(() => new Response("<html lang='en'>oops</html>"));

    const error = await http.get("/items/1", itemSchema).catch((e) => e);

    expect(error).toBeInstanceOf(UnexpectedResponseError);
    expect(error.cause).toBeInstanceOf(SyntaxError);
  });

  test("wraps network errors in HttpNetworkError", async () => {
    const { http } = setup(() => Promise.reject(new Error("network down")));

    const error = await http.get("/items/1", itemSchema).catch((e) => e);

    expect(error).toBeInstanceOf(HttpNetworkError);
    expect(error.name).toBe("HttpNetworkError");
    expect(error.cause.message).toBe("network down");
  });

  test("wraps a connection dropped while reading the body in HttpNetworkError", async () => {
    const { http } = setup(
      () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.error(new Error("connection reset"));
            },
          }),
        ),
    );

    const error = await http.get("/items/1", itemSchema).catch((e) => e);

    expect(error).toBeInstanceOf(HttpNetworkError);
    expect(error.cause.message).toBe("connection reset");
  });

  test("wraps timeouts in HttpTimeoutError", async () => {
    const { http } = setup(() =>
      Promise.reject(new DOMException("timed out", "TimeoutError")),
    );

    const error = await http.get("/items/1", itemSchema).catch((e) => e);

    expect(error).toBeInstanceOf(HttpTimeoutError);
    expect(error.name).toBe("HttpTimeoutError");
  });

  test("every failure is an HttpClientError", async () => {
    const responses = [
      () => new Response("nope", { status: 500 }),
      () => new Response("not json"),
      () => Promise.reject(new Error("network down")),
      () => Promise.reject(new DOMException("timed out", "TimeoutError")),
    ];

    for (const response of responses) {
      const { http } = setup(response);
      const error = await http.get("/items/1", itemSchema).catch((e) => e);
      expect(error).toBeInstanceOf(HttpClientError);
    }
  });
});

describe("HttpClient request context", () => {
  test("logs through the request log and forwards the request id", async () => {
    const { http, headers, entries } = setup(() => Response.json({ id: 1 }));

    await http.get("/items/1", itemSchema);

    expect(headers().get("X-Request-Id")).toBe("req-1");
    expect(entries[0]).toMatchObject({
      msg: "outgoing request completed",
      requestId: "req-1",
    });
  });

  test("keeps concurrent requests apart", async () => {
    const { client, headers } = setup(async () => {
      await Bun.sleep(1);
      return Response.json({ id: 1 });
    });
    const { log } = createTestLog();

    await Promise.all(
      ["req-a", "req-b"].map((requestId) =>
        runWithRequestContext(
          { log, requestId, signal: new AbortController().signal },
          () => client.get("/items/1", itemSchema),
        ),
      ),
    );

    expect([
      headers(0).get("X-Request-Id"),
      headers(1).get("X-Request-Id"),
    ]).toEqual(["req-a", "req-b"]);
  });

  test("cancels the upstream call when the client disconnects", async () => {
    const client = new AbortController();
    const context = { ...createContext(), signal: client.signal };
    const http = inRequest(
      new HttpClient({
        baseUrl: "https://api.example.com",
        fetch: hangingFetch,
      }),
      context,
    );

    const pending = http.get("/items/1", itemSchema).catch((e: unknown) => e);
    client.abort();

    expect(await pending).toBeInstanceOf(HttpAbortedError);
    expect(context.entries[0]).toMatchObject({
      level: 30,
      msg: "outgoing request aborted by client",
      method: "GET",
    });
  });

  test("still times out while the client is connected", async () => {
    const http = inRequest(
      new HttpClient({
        baseUrl: "https://api.example.com",
        timeoutMs: 1,
        fetch: hangingFetch,
      }),
      createContext(),
    );

    const error = await http.get("/items/1", itemSchema).catch((e) => e);

    expect(error).toBeInstanceOf(HttpTimeoutError);
  });

  test("refuses to run outside a request", async () => {
    const { client, calls } = setup(() => Response.json({ id: 1 }));

    const error = await client.get("/items/1", itemSchema).catch((e) => e);

    expect(error.message).toBe("request context accessed outside of a request");
    expect(calls).toHaveLength(0);
  });
});

describe("HttpClient logging", () => {
  test("logs successful requests at info with method, url, status and duration", async () => {
    const { http, entries } = setup(() => Response.json({ id: 1 }));

    await http.get("/items/1", itemSchema);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      level: 30,
      msg: "outgoing request completed",
      method: "GET",
      url: "https://api.example.com/items/1",
      status: 200,
    });
    expect(entries[0]?.durationMs).toBeNumber();
  });

  test("logs non-2xx responses at warn", async () => {
    const { http, entries } = setup(
      () => new Response("nope", { status: 503 }),
    );

    await http.get("/items/1", itemSchema).catch(() => undefined);

    expect(entries[0]).toMatchObject({ level: 40, status: 503 });
  });

  test("logs network errors at warn", async () => {
    const { http, entries } = setup(() =>
      Promise.reject(new Error("network down")),
    );

    await http.get("/items/1", itemSchema).catch(() => undefined);

    expect(entries[0]).toMatchObject({
      level: 40,
      msg: "outgoing request failed",
      method: "GET",
      err: { message: "network down" },
    });
  });

  test("never logs query strings or headers", async () => {
    const { http, entries } = setup(() => Response.json({ id: 1 }));

    await http.get("/items", itemSchema, { query: { token: "q-secret" } });

    const logged = JSON.stringify(entries);
    expect(entries[0]?.url).toBe("https://api.example.com/items");
    expect(logged).not.toContain("q-secret");
    expect(logged).not.toContain("Bearer secret");
  });
});
