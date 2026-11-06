import type { ErrorHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ClientErrorStatusCode } from "hono/utils/http-status";
import { STATUS_CODES } from "node:http";
import {
  ApiError,
  HttpAbortedError,
  HttpClientError,
  HttpError,
  HttpTimeoutError,
  ValidationError,
} from "@/errors";
import { getRequestId, getRequestLog } from "@/contexts/request";
import type { ErrorResponse } from "@/types/responses";

/**
 * Maps thrown errors to JSON `ErrorResponse`s that always carry the request id.
 * Branch order matters: specific `HttpClientError` subclasses come before the
 * generic one. Internal details are logged, never returned to the client.
 */
export function errorHandler(): ErrorHandler {
  return (err, c) => {
    const requestId = getRequestId();
    const log = getRequestLog();

    // Invalid request input (from `validate`): 400 with issues; expected, not logged.
    // `code` is the first issue's message, a translation key in the app's schemas.
    if (err instanceof ValidationError) {
      return c.json<ErrorResponse>(
        {
          error: "Bad Request",
          ...(err.issues[0] && { code: err.issues[0].message }),
          requestId,
          issues: err.issues,
        },
        400,
      );
    }

    // Expected failure (not found, forbidden, ...): its status and code; not logged.
    if (err instanceof ApiError) {
      return c.json<ErrorResponse>(
        { error: STATUS_CODES[err.status]!, code: err.code, requestId },
        err.status,
      );
    }

    // Raised by Hono itself, e.g. a malformed JSON body (400).
    if (err instanceof HTTPException) {
      return c.json<ErrorResponse>(
        { error: STATUS_CODES[err.status] ?? "Error", requestId },
        err.status,
      );
    }

    // Upstream status the route chose to pass through (e.g. 404): forwarded as is.
    // Already logged by `HttpClient`.
    if (err instanceof HttpError && err.passthrough) {
      const status = err.status as ClientErrorStatusCode;
      return c.json<ErrorResponse>(
        { error: STATUS_CODES[status] ?? "Upstream Error", requestId },
        status,
      );
    }

    // Client disconnected mid-request: nginx-style 499; nobody reads the response.
    if (err instanceof HttpAbortedError) {
      log.info("client closed request");
      return c.json<ErrorResponse>(
        { error: "Client Closed Request", requestId },
        499 as ClientErrorStatusCode,
      );
    }

    // Upstream did not answer within the timeout: 504.
    if (err instanceof HttpTimeoutError) {
      log.warn({ err }, "upstream request timed out");
      return c.json<ErrorResponse>(
        { error: "Gateway Timeout", requestId },
        504,
      );
    }

    // Any other upstream failure (error status, network, unexpected body): 502.
    if (err instanceof HttpClientError) {
      log.warn({ err }, "upstream request failed");
      return c.json<ErrorResponse>({ error: "Bad Gateway", requestId }, 502);
    }

    // Bug or unknown error: 500 without details.
    log.error({ err }, "unhandled error");
    return c.json<ErrorResponse>(
      { error: "Internal Server Error", requestId },
      500,
    );
  };
}
