import { describe, expect, test } from "bun:test";
import {
  AppError,
  HttpAbortedError,
  HttpClientError,
  HttpError,
  HttpNetworkError,
  HttpTimeoutError,
  UnexpectedResponseError,
  ValidationError,
} from "@/errors";

describe("errors", () => {
  test("every error is named after its class", () => {
    const errors = [
      new AppError("x"),
      new ValidationError([]),
      new HttpClientError("x"),
      new HttpError(500, new Headers(), ""),
      new UnexpectedResponseError(null),
      new HttpTimeoutError(null),
      new HttpAbortedError(null),
      new HttpNetworkError(null),
    ];

    for (const error of errors) {
      expect(error.name).toBe(error.constructor.name);
      expect(error).toBeInstanceOf(AppError);
    }
  });

  test("HttpError does not pass its status through by default", () => {
    expect(new HttpError(404, new Headers(), "").passthrough).toBe(false);
    expect(new HttpError(404, new Headers(), "", true).passthrough).toBe(true);
  });
});
