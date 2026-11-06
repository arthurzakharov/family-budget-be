import { Hono } from "hono";
import type { CommitInfo } from "@/types/commit-info";
import type { HealthResponse } from "@/types/responses";

/**
 * Liveness endpoint at `/health` (used by the Docker HEALTHCHECK).
 * The response is built once at startup; it never changes at runtime.
 */
export function createHealthRoutes(commitInfo: CommitInfo | null) {
  const body: HealthResponse = {
    status: "ok",
    commit: commitInfo && {
      shortHash: commitInfo.shortHash,
      date: commitInfo.date,
    },
  };

  return new Hono().get("/health", (c) => c.json(body));
}
