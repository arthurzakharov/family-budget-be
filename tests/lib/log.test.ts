import { describe, expect, test } from "bun:test";
import { buildLogOptions, createLog } from "@/lib/log";

describe("log", () => {
  test("uses JSON output without a transport when pretty is disabled", () => {
    const options = buildLogOptions({ level: "info", pretty: false });
    expect(options.level).toBe("info");
    expect(options.transport).toBeUndefined();
  });

  test("uses pino-pretty transport when pretty is enabled", () => {
    const options = buildLogOptions({ level: "debug", pretty: true });
    expect(options.transport).toMatchObject({ target: "pino-pretty" });
  });

  test("creates a log with the requested level", () => {
    const log = createLog({ level: "warn", pretty: false });
    expect(log.level).toBe("warn");
  });
});
