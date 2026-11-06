import type { Env } from "@/config/env";
import type { CommitInfo } from "@/types/commit-info";
import type { Log } from "@/types/log";

/** Runtime context included in the startup log entry. */
type LogServerStartParams = {
  env: Env;
  commitInfo: CommitInfo | null;
};

/**
 * Logs a single "server started" entry with port, environment, commit info and
 * allowed CORS origins. Emits an extra warning when commit info is unavailable.
 */
export function logServerStart(
  log: Log,
  { env, commitInfo }: LogServerStartParams,
): void {
  log.info(
    {
      port: env.PORT,
      env: env.NODE_ENV,
      commit: commitInfo,
      allowedOrigins: env.ALLOWED_ORIGINS,
    },
    "server started",
  );
  if (!commitInfo) {
    log.warn("commit info unavailable");
  }
}
