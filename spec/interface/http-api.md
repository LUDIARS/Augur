# HTTP API

> **Superseded transport (neco 2026-07-30).** Augur ships as a daemon-less CLI;
> see [Daemon-less CLI](../plan/daemonless-cli.md) and [CLI](./cli.md). This
> document is retained as the reference for the `CreatePlanRequest` and
> `PlanResponse` shapes, which the CLI uses unchanged — the schema outlives the
> transport. The server, the port, and `GET /v1/health` are removed in migration
> step A3 — **after** its one caller, Anatomia's Test Suggestions bridge, moves to
> `augur plan --request -` (step A2b). Until then this document describes a live
> surface.

`POST /v1/plans` also accepts the optional `focusedTesting` object documented in
[Focused Testing](../feature/focused-testing.md). Invalid priorities, duplicate domains, empty
target sets, or unsupported risk kinds return the normal validation `400` envelope.

## Overview

Augur exposes an HTTP API for callers that need a structured test plan and fix policy.

The API is runner-agnostic. Test execution remains outside Augur.

## Create Plan

```http
POST /v1/plans
Content-Type: application/json
```

### Request

Body: `CreatePlanRequest`

Example:

```json
{
  "objective": {
    "kind": "bug_fix",
    "description": "Fix search returning stale results after clearing the query.",
    "desiredOutcome": "Search results should reset when query is empty."
  },
  "project": {
    "name": "example-web",
    "domain": "web",
    "language": "typescript",
    "frameworks": ["react", "vite"],
    "testRunners": ["vitest", "playwright"]
  },
  "change": {
    "changedFiles": ["src/search.ts", "src/search.test.ts"]
  },
  "failure": {
    "command": "npm run test",
    "exitCode": 1,
    "stderr": "expected [] to equal [...]"
  }
}
```

### Response

Body: `PlanResponse`

Example:

```json
{
  "summary": "Create a regression test for cleared search queries, then apply a narrow state reset fix.",
  "testPlan": {
    "suggestions": [
      {
        "id": "test-001",
        "title": "Clearing query resets stale search results",
        "kind": "regression",
        "priority": "high",
        "confidence": 0.87,
        "targetFiles": ["src/search.test.ts"],
        "rationale": "The objective describes stale results after clearing the query.",
        "draft": {
          "framework": "vitest",
          "description": "Given existing results, when the query becomes empty, expect displayed results to become empty."
        },
        "evidenceIds": ["ev-001"]
      }
    ]
  },
  "fixPolicy": {
    "strategy": "test_first",
    "steps": [
      {
        "id": "fix-001",
        "title": "Add failing regression coverage",
        "description": "Add a test that reproduces stale results after clearing the query.",
        "targetFiles": ["src/search.test.ts"],
        "evidenceIds": ["ev-001"]
      },
      {
        "id": "fix-002",
        "title": "Reset result state for empty query",
        "description": "Apply the smallest code change that clears cached results when query input is blank.",
        "targetFiles": ["src/search.ts"],
        "dependsOn": ["fix-001"],
        "evidenceIds": ["ev-001", "ev-002"]
      }
    ],
    "risks": [
      {
        "id": "risk-001",
        "severity": "medium",
        "description": "Reset behavior may affect consumers that expect cached results to remain visible."
      }
    ],
    "rollback": "Revert the state reset change and keep the regression test skipped only if product behavior is redefined."
  },
  "evidence": [
    {
      "id": "ev-001",
      "type": "objective",
      "detail": "Caller requested a bug fix for stale search results after clearing the query."
    },
    {
      "id": "ev-002",
      "type": "failure_log",
      "detail": "npm run test exited with code 1: expected [] to equal [...]"
    }
  ]
}
```

## Experience-Driven Requests

`CreatePlanRequest` accepts `experienceGoals` so callers can express UX qualities and budgets directly. Semantics are defined in [Experience-Driven Constraints](../feature/experience-driven-constraints.md).

Request fragment:

```json
{
  "objective": {
    "kind": "performance",
    "description": "The app should feel instant."
  },
  "experienceGoals": [
    {
      "quality": "responsiveness",
      "targets": [
        { "metric": "api_latency", "threshold": 20, "unit": "ms", "percentile": 95 }
      ],
      "exemptions": [
        {
          "scope": "auth (login, registration)",
          "reason": "Users tolerate multi-second auth flows.",
          "relaxedTarget": { "metric": "api_latency", "threshold": 3000, "unit": "ms", "percentile": 95 }
        }
      ]
    }
  ],
  "runtimeSignals": [
    { "type": "api_latency", "name": "search p95", "value": 42, "unit": "ms", "percentile": 95, "scope": "/search" },
    { "type": "api_latency", "name": "login p95", "value": 800, "unit": "ms", "percentile": 95, "scope": "/login" }
  ]
}
```

The resulting plan contains a `critical` guardrail for `/search` (explicit 20ms budget, already violated at 42ms) carrying the budget in the suggestion's `budget` field, and a lower-priority guardrail for auth flows against the relaxed 3s budget. The `/login` measurement is not flagged as a violation because it falls inside the exempted scope and under the relaxed budget.

## Retrieve a Stored Plan (Phase 5)

> These two Phase 5 routes will not be built: with the daemon removed, retrieval
> and deletion are reached by subcommand. They are kept as the description of the
> operations (id lookup, permanent delete, retention) that
> [Plan Persistence](../data/persistence.md) carries over to the CLI.

Available only when persistence is enabled; semantics in [Plan Persistence](../data/persistence.md).

```http
GET /v1/plans/{planId}
```

Response: the stored `PlanResponse` with `planId` and `createdAt` stamped. Unknown ids — and any id while persistence is disabled — return `404`:

```json
{
  "error": {
    "code": "not_found",
    "message": "No plan with id plan_01J..."
  }
}
```

## Delete a Stored Plan (Phase 5)

```http
DELETE /v1/plans/{planId}
```

Returns `204` with no body on success, `404` with the envelope above when unknown. Stored plans contain the caller's request signals (diffs, logs), so deletion is caller-controlled and permanent.

## Health Check

```http
GET /v1/health
```

Response:

```json
{
  "status": "ok"
}
```

## Error Responses

Validation errors should return `400`.

```json
{
  "error": {
    "code": "invalid_request",
    "message": "objective.description is required"
  }
}
```

Unexpected server errors should return `500`.

```json
{
  "error": {
    "code": "internal_error",
    "message": "Unexpected planning error"
  }
}
```

