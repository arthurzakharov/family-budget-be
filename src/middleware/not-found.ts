import type { NotFoundHandler } from "hono";
import { getRequestId } from "@/contexts/request";
import type { AppEnv } from "@/types/app-env";
import type { ErrorResponse } from "@/types/responses";

/** Responds with a JSON 404 for unknown routes. */
export function notFound(): NotFoundHandler<AppEnv> {
  return (c) => {
    return c.json<ErrorResponse>(
      { error: "Not Found", requestId: getRequestId() },
      404,
    );
  };
}
