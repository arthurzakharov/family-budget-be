import { describe, expect, test } from "bun:test";
import { parseEnv } from "@/config/env";

const LOCAL_DATABASE_URL =
  "postgres://familly_budget:familly_budget@localhost:5432/familly_budget";
const PROD_DATABASE_URL = "postgres://user:pass@db.example.com:5432/budget";

describe("parseEnv", () => {
  test("applies defaults", () => {
    expect(parseEnv({})).toEqual({
      NODE_ENV: "development",
      PORT: 3000,
      LOG_LEVEL: "info",
      LOG_FORMAT: "json",
      ALLOWED_ORIGINS: [],
      DATABASE_URL: LOCAL_DATABASE_URL,
    });
  });

  test("parses provided values", () => {
    expect(
      parseEnv({
        NODE_ENV: "production",
        PORT: "8080",
        LOG_LEVEL: "warn",
        LOG_FORMAT: "pretty",
        ALLOWED_ORIGINS: " https://app.example.com, http://localhost:5173 ,",
        DATABASE_URL: PROD_DATABASE_URL,
      }),
    ).toEqual({
      NODE_ENV: "production",
      PORT: 8080,
      LOG_LEVEL: "warn",
      LOG_FORMAT: "pretty",
      ALLOWED_ORIGINS: ["https://app.example.com", "http://localhost:5173"],
      DATABASE_URL: PROD_DATABASE_URL,
    });
  });

  test("treats empty GIT_COMMIT_* values as unset", () => {
    const env = parseEnv({
      GIT_COMMIT_HASH: "",
      GIT_COMMIT_MESSAGE: "",
      GIT_COMMIT_AUTHOR: "",
      GIT_COMMIT_DATE: "",
    });

    expect(env.GIT_COMMIT_HASH).toBeUndefined();
    expect(env.GIT_COMMIT_MESSAGE).toBeUndefined();
    expect(env.GIT_COMMIT_AUTHOR).toBeUndefined();
    expect(env.GIT_COMMIT_DATE).toBeUndefined();
    expect(parseEnv({ GIT_COMMIT_HASH: "abc" }).GIT_COMMIT_HASH).toBe("abc");
  });

  test("requires ALLOWED_ORIGINS in production", () => {
    expect(() =>
      parseEnv({ NODE_ENV: "production", DATABASE_URL: PROD_DATABASE_URL }),
    ).toThrow(/required in production[\s\S]*ALLOWED_ORIGINS/);
    expect(() =>
      parseEnv({
        NODE_ENV: "production",
        ALLOWED_ORIGINS: " , ",
        DATABASE_URL: PROD_DATABASE_URL,
      }),
    ).toThrow(/required in production[\s\S]*ALLOWED_ORIGINS/);
  });

  test("requires DATABASE_URL in production", () => {
    for (const DATABASE_URL of [undefined, " "]) {
      expect(() =>
        parseEnv({
          NODE_ENV: "production",
          ALLOWED_ORIGINS: "https://app.example.com",
          DATABASE_URL,
        }),
      ).toThrow(/required in production[\s\S]*DATABASE_URL/);
    }
  });

  test("falls back to the local database outside production", () => {
    expect(parseEnv({ DATABASE_URL: "" }).DATABASE_URL).toBe(
      LOCAL_DATABASE_URL,
    );
    expect(
      parseEnv({ DATABASE_URL: "postgresql://u:p@h/db" }).DATABASE_URL,
    ).toBe("postgresql://u:p@h/db");
  });

  test("does not require deployment variables outside production", () => {
    expect(() => parseEnv({ NODE_ENV: "development" })).not.toThrow();
    expect(() => parseEnv({ NODE_ENV: "test" })).not.toThrow();
  });

  test("normalises origins to what browsers send (no trailing slash or path)", () => {
    expect(
      parseEnv({
        ALLOWED_ORIGINS:
          "http://localhost:5173/,https://app.example.com/some/path",
      }).ALLOWED_ORIGINS,
    ).toEqual(["http://localhost:5173", "https://app.example.com"]);
  });

  test("throws a readable error for invalid values", () => {
    expect(() =>
      parseEnv({
        PORT: "abc",
        LOG_LEVEL: "loud",
        LOG_FORMAT: "fancy",
        ALLOWED_ORIGINS: "not-a-url",
        DATABASE_URL: "mysql://u:p@h/db",
      }),
    ).toThrow(
      /Invalid env variables[\s\S]*PORT[\s\S]*LOG_LEVEL[\s\S]*LOG_FORMAT[\s\S]*DATABASE_URL[\s\S]*ALLOWED_ORIGINS/,
    );
  });
});
