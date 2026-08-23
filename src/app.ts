import { Hono } from "hono";
import { z } from 'zod';
import {
  NotFoundError,
  NotImplementedOperationError,
  OperationConflictError,
  InvalidOperationInputError,
  type TestOperations,
} from './operations/tests.ts';
import { FlagPreconditionError } from './tests/flag.ts';
import { RegistryValidationError } from './tests/registry.ts';
import { EmptyBundleError, RunHeadMismatchError } from './tests/run.ts';
import { internalError } from "./routes/errors.ts";
import { healthRoute } from "./routes/health.ts";
import { plansRoute } from "./routes/plans.ts";
import { createTestsRoute } from './routes/tests.ts';

// Errors escaping a route (planning bugs, not caller mistakes) are logged
// here and mapped to the documented 500 envelope; swallowing them silently
// would hide engine failures (RULE_CODE §7 / §15).
export type AppLogger = { error: (obj: unknown, msg?: string) => void };

export function createApp(logger?: AppLogger, operations?: TestOperations): Hono {
  const app = new Hono();
  app.route("/v1", healthRoute);
  app.route("/v1", plansRoute);
  app.route('/v1', createTestsRoute(operations));
  app.onError((err, c) => {
    if (err instanceof NotFoundError) return c.json({ error: { code: err.code, message: err.message } }, 404);
    if (err instanceof NotImplementedOperationError) return c.json({ error: { code: err.code, message: err.message } }, 501);
    if (err instanceof OperationConflictError) return c.json({ error: { code: err.code, message: err.message } }, 409);
    if (err instanceof InvalidOperationInputError) return c.json({ error: { code: err.code, message: err.message } }, 400);
    if (err instanceof EmptyBundleError || err instanceof RunHeadMismatchError || err instanceof FlagPreconditionError || err instanceof RegistryValidationError || err instanceof z.ZodError) {
      return c.json({ error: { code: 'invalid_request', message: err.message } }, 400);
    }
    logger?.error({ err }, "request failed");
    return internalError(c);
  });
  return app;
}
