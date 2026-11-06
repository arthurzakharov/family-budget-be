import { createApp } from "@/app";
import { parseEnv } from "@/config/env";
import { createDb, runMigrations } from "@/db/client";
import { resolveCommitInfo } from "@/lib/commit-info";
import { handleShutdownSignals } from "@/lib/graceful-shutdown";
import { createLog } from "@/lib/log";
import { logServerStart } from "@/lib/startup-log";

// Parse and validate environment variables
const env = parseEnv(process.env);

// Get Pino log instance
const log = createLog({
  level: env.LOG_LEVEL,
  pretty: env.LOG_FORMAT === "pretty",
});

// Connect to Postgres and apply pending migrations before serving requests
const db = createDb(env.DATABASE_URL);
await runMigrations(db);
log.info("database migrations applied");

// Resolve commit info from env or local git
const commitInfo = resolveCommitInfo(env);

// Create Hono app
// Session cookies are `Secure` (HTTPS only) everywhere but local development
const app = createApp({
  log,
  commitInfo,
  origin: env.ALLOWED_ORIGINS,
  db,
  cookie: { secure: env.NODE_ENV === "production" },
});

// Start Bun server on env.PORT
const server = Bun.serve({ port: env.PORT, fetch: app.fetch });

// Log startup; warn if commit info is unavailable
logServerStart(log, { env, commitInfo });

// Gracefully stop server on SIGINT/SIGTERM
handleShutdownSignals(log, server);
