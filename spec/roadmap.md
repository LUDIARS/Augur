# Implementation Roadmap

This document defines the order of implementation for Augur and the acceptance bar for each phase. Phases are sequential; a phase starts only when the previous phase's acceptance criteria are met.

Technology choices, module layout, and internal interfaces for these phases are defined in the [Implementation Design](./implementation-design.md).

Status: design is complete for all phases. Phases 0–2 are implemented; Phases 3–5 are designed ([CLI](./interface/cli.md), [LLM Assistance](./feature/llm-assistance.md), [Plan Persistence](./data/persistence.md)) and not yet implemented.

## Phase 0 — Project Scaffolding

Scope:

- `package.json`, TypeScript configuration, Vitest, linting.
- CI pipeline running `npm run build`, `npm run lint`, and `npm run test`.
- Shared types generated from the [Core Data Schema](./data/core-schema.md) as the single source of truth (`src/schema/`).

Acceptance:

- CI is green on an empty-but-compiling project.
- Schema types compile and are exported from one module.

## Phase 1 — Core Planning Engine

Scope:

- The six-stage pipeline defined in the [Planning Engine](./feature/planning-engine.md) spec.
- Rule modules for all eight objective kinds.
- Experience goal resolution, caller-supplied exemptions, and budget-violation detection per [Experience-Driven Constraints](./feature/experience-driven-constraints.md) (deterministic parts only; LLM exemption proposals are Phase 4).
- Evidence extraction, scoring, and deterministic assembly.

Acceptance:

- Unit tests for normalization, evidence extraction, scoring, and each rule module pass.
- Golden tests for the representative requests in the [Service Test Strategy](./test/service-test-strategy.md) pass.
- ST-001 through ST-011 and ST-013 pass at the engine level (no HTTP involved; ST-012 requires Phase 4).

## Phase 2 — HTTP API

Scope:

- HTTP server exposing `POST /v1/plans` and `GET /v1/health` per the [HTTP API](./interface/http-api.md) spec.
- Request validation returning `400` with the documented error shape.
- Safety tests proving the service never shells out or touches application code.

Acceptance:

- API tests pass against a running server instance.
- The local startup flow in [Local Development Setup](./setup/local-development.md) works end to end.

## Phase 3 — CLI Interface

Design: [CLI](./interface/cli.md).

Scope:

- An `augur plan` command that gathers local signals (git diff, changed files, optional log/coverage/analyzer files) and prints a plan, reusing the Phase 1 engine directly.
- Output formats: human-readable text and `--json` for agents.

Acceptance:

- The CLI implements the flag surface, exit codes, and gathering behavior in the CLI spec.
- The CLI produces the same plan as the HTTP API for the same input (parity test).

## Phase 4 — LLM Assistance

Design: [LLM Assistance](./feature/llm-assistance.md).

Scope:

- The optional prose enrichment stage defined in the [Planning Engine](./feature/planning-engine.md) spec, with the runtime structural guard.
- LLM exemption proposals: semantic judgment of which scopes a UX budget should not strictly cover (for example, login and registration flows), emitted as labeled `ExperienceExemption` proposals.
- Provider abstraction behind `AUGUR_LLM_PROVIDER` / `AUGUR_LLM_API_KEY`.

Acceptance:

- With LLM assistance disabled, all golden tests still pass unchanged.
- Tests prove prose enrichment cannot alter structural fields.
- ST-012 passes: LLM-proposed exemptions are labeled, never delete guardrails, and never override caller-explicit targets.

## Phase 5 — Persistence and History

Design: [Plan Persistence](./data/persistence.md). The [Core Data Schema](./data/core-schema.md) already carries the backward-compatible `planId`/`createdAt` additions.

Scope:

- Optional storage of issued plans behind the `PlanStore` interface (SQLite file store, in-memory store for tests), off by default.
- `GET /v1/plans/{planId}` and `DELETE /v1/plans/{planId}`, with retention sweep.

Acceptance:

- With persistence disabled, responses are byte-identical to Phase 2 output.
- Store contract tests pass against both store implementations; delete-then-get returns `404`.

## Non-Goals

These stay out of scope for all phases above:

- Executing tests or any shell command on behalf of the caller.
- Generating or applying code patches.
- Repository crawling; Augur only sees what a request supplies.
