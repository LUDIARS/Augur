import type { Context } from "hono";
import type { ZodError } from "zod";

export function invalidRequest(c: Context, message: string): Response {
  return c.json({ error: { code: "invalid_request", message } }, 400);
}

export function internalError(c: Context): Response {
  return c.json({ error: { code: "internal_error", message: "Unexpected Augur error" } }, 500);
}

export function validationMessage(error: ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "Request body is invalid";
  const path = issue.path.join(".");
  return path ? `${path}: ${issue.message}` : issue.message;
}
