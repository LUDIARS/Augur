import { Hono } from "hono";
import { internalError } from "./routes/errors.ts";
import { healthRoute } from "./routes/health.ts";
import { plansRoute } from "./routes/plans.ts";

// Errors escaping a route (planning bugs, not caller mistakes) are logged
// here and mapped to the documented 500 envelope; swallowing them silently
// would hide engine failures (RULE_CODE §7 / §15).
export type AppLogger = { error: (obj: unknown, msg?: string) => void };

export function createApp(logger?: AppLogger): Hono {
  const app = new Hono();
  app.route("/v1", healthRoute);
  app.route("/v1", plansRoute);
  app.onError((err, c) => {
    logger?.error({ err }, "plan creation failed");
    return internalError(c);
  });
  return app;
}
