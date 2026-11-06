import pino from "pino";

export type LogEntry = Record<string, unknown> & { level: number; msg: string };

export function createTestLog(): {
  log: pino.Logger;
  entries: LogEntry[];
} {
  const entries: LogEntry[] = [];
  const log = pino(
    { level: "trace" },
    { write: (line: string) => entries.push(JSON.parse(line)) },
  );
  return { log, entries };
}
