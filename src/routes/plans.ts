import { Hono } from "hono";
import { createPlan } from "../engine/createPlan.ts";
import { createPlanRequestSchema } from "../schema/index.ts";
import { invalidRequest, validationMessage } from "./errors.ts";

// Validation happens here so the caller gets the documented 400 envelope
// with a path-prefixed message; engine errors propagate to app.onError.

export const plansRoute = new Hono().post("/plans", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return invalidRequest(c, "Request body must be valid JSON");
  }

  const parsed = createPlanRequestSchema.safeParse(body);
  if (!parsed.success) {
    return invalidRequest(c, validationMessage(parsed.error));
  }

  return c.json(createPlan(parsed.data));
});
