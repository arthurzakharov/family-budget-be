import type { RequestIdVariables } from "hono/request-id";
import type { Log } from "@/types/log";

export type AppEnv = {
  Variables: RequestIdVariables & {
    log: Log;
  };
};
