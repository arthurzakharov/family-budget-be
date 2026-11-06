export type LogFn = {
  (obj: object, msg?: string): void;
  (msg: string): void;
};

export type LogLevels =
  "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent";

export type Log = Record<LogLevels, LogFn> & {
  child(bindings: Record<string, unknown>): Log;
};
