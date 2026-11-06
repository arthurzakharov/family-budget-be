import type { ValidationIssue } from "@/types/responses";

/** Base class for app errors; `name` is set to the concrete subclass name. */
export class AppError extends Error {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** Invalid request input (thrown by `validate`); answered with 400 and `issues`. */
export class ValidationError extends AppError {
  public constructor(public readonly issues: ValidationIssue[]) {
    super("request validation failed");
  }
}

/** Base class for failures of outgoing `HttpClient` requests; answered with 502 unless more specific. */
export class HttpClientError extends AppError {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
  }
}

/**
 * Upstream answered with a non-2xx status. `passthrough` forwards that status to
 * the caller instead of 502.
 */
export class HttpError extends HttpClientError {
  // Both fields are private so the log serializer never writes them.
  /** Upstream response headers; may contain auth tokens or cookies. */
  readonly #headers: Headers;
  /** Raw upstream response body; may contain personal data. */
  readonly #body: string;

  public constructor(
    public readonly status: number,
    headers: Headers,
    body: string,
    public readonly passthrough: boolean = false,
  ) {
    super(`request failed with status ${status}`);
    this.#headers = headers;
    this.#body = body;
  }

  public get headers(): Headers {
    return this.#headers;
  }

  public get body(): string {
    return this.#body;
  }
}

/** Upstream answered 2xx but the body is not JSON or fails the schema. */
export class UnexpectedResponseError extends HttpClientError {
  public constructor(cause: unknown) {
    super("response body does not match the expected schema", { cause });
  }
}

/** Upstream did not answer within the client timeout; answered with 504. */
export class HttpTimeoutError extends HttpClientError {
  public constructor(cause: unknown) {
    super("request timed out", { cause });
  }
}

/** Our client disconnected, so the outgoing request was cancelled; answered with 499. */
export class HttpAbortedError extends HttpClientError {
  public constructor(cause: unknown) {
    super("request was aborted because the client disconnected", { cause });
  }
}

/** Connection failed or the response was cut off (DNS, refused, reset, ...). */
export class HttpNetworkError extends HttpClientError {
  public constructor(cause: unknown) {
    super("request failed before a complete response was received", {
      cause,
    });
  }
}

/**
 * Expected failure of a request (not found, forbidden, conflict, ...).
 * `code` is a translation key (e.g. `errors.groupNotFound`) the frontend
 * shows in the chosen language.
 */
export class ApiError extends AppError {
  public constructor(
    public readonly status: ApiErrorStatus,
    public readonly code: string,
  ) {
    super(code);
  }
}

/** Statuses an `ApiError` may carry. */
export type ApiErrorStatus = 400 | 401 | 403 | 404 | 409;
