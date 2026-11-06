import type { Log } from "@/types/log";

/** Server methods needed for shutdown. */
type StoppableServer = Pick<Bun.Server<undefined>, "stop">;

/** Signals that trigger graceful shutdown. */
const SHUTDOWN_SIGNALS = ["SIGINT", "SIGTERM"] as const;

/** Max time to wait for in-flight requests before force-closing. */
const DEFAULT_TIMEOUT_MS = 5000;

/**
 * Registers SIGINT/SIGTERM handlers that stop the server gracefully and exit
 * the process: code 0 on success, 1 if stopping fails.
 */
export function handleShutdownSignals(
  log: Log,
  server: StoppableServer,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): void {
  for (const signal of SHUTDOWN_SIGNALS) {
    process.once(signal, async () => {
      log.info({ signal }, "shutting down");
      let exitCode = 0;
      try {
        await stopServer(log, server, timeoutMs);
      } catch (err) {
        log.error({ err }, "server did not stop cleanly");
        exitCode = 1;
      }
      process.exit(exitCode);
    });
  }
}

/**
 * Stops the server, letting in-flight requests finish; after `timeoutMs`
 * forcibly closes remaining connections.
 */
async function stopServer(
  log: Log,
  server: StoppableServer,
  timeoutMs: number,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const forceStop = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      log.warn(
        { timeoutMs },
        "requests still running after shutdown timeout, closing connections",
      );
      resolve(server.stop(true));
    }, timeoutMs);
  });

  await Promise.race([server.stop(), forceStop]);
  clearTimeout(timer);
}
