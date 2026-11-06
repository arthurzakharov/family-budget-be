import { describe, expect, test } from "bun:test";
import { parseEnv } from "@/config/env";
import { logServerStart } from "@/lib/startup-log";
import { createTestLog } from "@tests/helpers/log";

const LEVEL = { info: 30, warn: 40 } as const;
const env = parseEnv({});
const commitInfo = {
  hash: "abc1234def5678",
  shortHash: "abc1234",
  message: "m",
  author: "a",
  date: "2026-10-02T00:00:00Z",
};

describe("logServerStart", () => {
  test("logs the full commit info without a warning when commit info is available", () => {
    const { log, entries } = createTestLog();

    logServerStart(log, {
      env,
      commitInfo,
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      level: LEVEL.info,
      msg: "server started",
      port: env.PORT,
      env: env.NODE_ENV,
      commit: commitInfo,
      allowedOrigins: env.ALLOWED_ORIGINS,
    });
  });

  test("logs a null commit and warns when commit info is unavailable", () => {
    const { log, entries } = createTestLog();

    logServerStart(log, {
      env,
      commitInfo: null,
    });

    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      level: LEVEL.info,
      commit: null,
    });
    expect(entries[1]).toMatchObject({ level: LEVEL.warn });
    expect(entries[1]?.msg).toStartWith("commit info unavailable");
  });
});
