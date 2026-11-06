import pino, { type LevelWithSilent } from "pino";

/**
 * Parameters required to configure and initialize the application log.
 */
type LogParams = {
  level: LevelWithSilent;
  pretty: boolean;
};

/**
 * Constructs the Pino configuration object based on runtime log parameters.
 * Configures default service metadata, ISO timestamp formatting, and optional
 * transport formatting for pretty terminal output.
 */
export function buildLogOptions({
  level,
  pretty,
}: LogParams): pino.LoggerOptions {
  return {
    level,
    base: { service: "familly-budget-be" },
    timestamp: pino.stdTimeFunctions.isoTime,
    ...(pretty && {
      transport: { target: "pino-pretty", options: { colorize: true } },
    }),
  };
}

/**
 * Creates and initializes a new Pino log instance.
 */
export function createLog(params: LogParams): pino.Logger {
  return pino(buildLogOptions(params));
}
