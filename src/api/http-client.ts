import type { ClientErrorStatusCode } from "hono/utils/http-status";
import {
  HttpAbortedError,
  HttpError,
  HttpNetworkError,
  HttpTimeoutError,
  UnexpectedResponseError,
} from "@/errors";
import {
  getRequestId,
  getRequestLog,
  getRequestSignal,
} from "@/contexts/request";

/** `fetch`-compatible function; injectable for tests. */
type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

/** Anything with `parse` (e.g. a Zod schema) that validates the response body. */
type Schema<T> = { parse(data: unknown): T };

/** Query parameter value; `undefined` values are skipped. */
type QueryValue = string | number | boolean | undefined;

/** Client-wide settings shared by every request. */
type HttpClientConstructor = {
  baseUrl: string;
  /** Sent with every request (e.g. auth); per-request headers override them. */
  headers?: Record<string, string>;
  /** Per-request timeout; defaults to 5000 ms. */
  timeoutMs?: number;
  fetch?: FetchFn;
};

/** Per-request options. */
type RequestParams = {
  query?: Record<string, QueryValue>;
  headers?: Record<string, string>;
  /** Upstream 4xx statuses forwarded to our caller instead of 502. */
  passthrough?: ClientErrorStatusCode[];
};

/** Internal params of `#send`, filled by the public method helpers. */
type SendParams = RequestParams & {
  method: string;
  body?: unknown;
};

/**
 * JSON HTTP client for upstream APIs, bound to the current request context:
 * forwards `X-Request-Id`, logs through the request log, and cancels the call
 * when our client disconnects or the timeout expires. Responses are validated
 * with `schema`; failures are thrown as `HttpClientError` subclasses.
 */
export class HttpClient {
  readonly #baseUrl: string;
  readonly #headers: Record<string, string>;
  readonly #timeoutMs: number;
  readonly #fetchFn: FetchFn;

  public constructor({
    baseUrl,
    headers = {},
    timeoutMs = 5000,
    fetch = globalThis.fetch,
  }: HttpClientConstructor) {
    this.#baseUrl = baseUrl;
    this.#headers = headers;
    this.#timeoutMs = timeoutMs;
    this.#fetchFn = fetch;
  }

  public get<T>(
    path: string,
    schema: Schema<T>,
    options?: RequestParams,
  ): Promise<T> {
    return this.#send(path, schema, { ...options, method: "GET" });
  }

  public post<T>(
    path: string,
    body: unknown,
    schema: Schema<T>,
    options?: RequestParams,
  ): Promise<T> {
    return this.#send(path, schema, { ...options, method: "POST", body });
  }

  public put<T>(
    path: string,
    body: unknown,
    schema: Schema<T>,
    options?: RequestParams,
  ): Promise<T> {
    return this.#send(path, schema, { ...options, method: "PUT", body });
  }

  public patch<T>(
    path: string,
    body: unknown,
    schema: Schema<T>,
    options?: RequestParams,
  ): Promise<T> {
    return this.#send(path, schema, { ...options, method: "PATCH", body });
  }

  public delete<T>(
    path: string,
    schema: Schema<T>,
    options?: RequestParams,
  ): Promise<T> {
    return this.#send(path, schema, { ...options, method: "DELETE" });
  }

  /** Performs the request, logs its outcome and parses the response. */
  async #send<T>(
    path: string,
    schema: Schema<T>,
    { method, body, query, headers, passthrough = [] }: SendParams,
  ): Promise<T> {
    const url = this.#buildUrl(path, query);
    const hasBody = body !== undefined;
    const start = performance.now();
    const fetch = this.#fetchFn;
    const log = getRequestLog();
    const requestId = getRequestId();
    const clientSignal = getRequestSignal();
    const timeoutSignal = AbortSignal.timeout(this.#timeoutMs);

    let res: Response;
    let text: string;
    try {
      res = await fetch(url, {
        method,
        headers: {
          ...this.#headers,
          "X-Request-Id": requestId,
          ...(hasBody && { "Content-Type": "application/json" }),
          ...headers,
        },
        ...(hasBody && { body: JSON.stringify(body) }),
        // Abort on client disconnect or timeout, whichever comes first.
        signal: AbortSignal.any([clientSignal, timeoutSignal]),
      });
      text = await res.text();
    } catch (err) {
      // Our client went away: not an upstream problem, so log at info.
      if (clientSignal.aborted) {
        log.info(
          { method, url: this.#logUrl(url), durationMs: this.#since(start) },
          "outgoing request aborted by client",
        );
        throw new HttpAbortedError(err);
      }
      log.warn(
        { method, url: this.#logUrl(url), durationMs: this.#since(start), err },
        "outgoing request failed",
      );
      throw isTimeout(err)
        ? new HttpTimeoutError(err)
        : new HttpNetworkError(err);
    }

    const info = {
      method,
      url: this.#logUrl(url),
      status: res.status,
      durationMs: this.#since(start),
    };

    // Upstream error status: thrown as `HttpError` (502 unless in `passthrough`).
    if (!res.ok) {
      log.warn(info, "outgoing request completed");
      throw new HttpError(
        res.status,
        res.headers,
        text,
        (passthrough as number[]).includes(res.status),
      );
    }
    log.info(info, "outgoing request completed");

    try {
      // Empty body (e.g. 204) is parsed as `undefined`.
      return schema.parse(text === "" ? undefined : JSON.parse(text));
    } catch (err) {
      throw new UnexpectedResponseError(err);
    }
  }

  /** Joins base URL, path and query; appends to an existing query string. */
  #buildUrl(path: string, query: Record<string, QueryValue> = {}): string {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) search.append(key, String(value));
    }
    const qs = search.toString();
    const url = `${this.#baseUrl}${path}`;
    if (!qs) return url;
    return `${url}${url.includes("?") ? "&" : "?"}${qs}`;
  }

  /** URL without query string, so secrets in query params are never logged. */
  #logUrl(url: string): string {
    const { origin, pathname } = new URL(url);
    return `${origin}${pathname}`;
  }

  /** Milliseconds since `start`, rounded to 2 decimals. */
  #since(start: number): number {
    return Math.round((performance.now() - start) * 100) / 100;
  }
}

/** `AbortSignal.timeout` rejects with a `TimeoutError` DOMException. */
function isTimeout(err: unknown): boolean {
  return err instanceof DOMException && err.name === "TimeoutError";
}
