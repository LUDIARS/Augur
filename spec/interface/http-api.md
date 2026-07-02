# HTTP API

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

