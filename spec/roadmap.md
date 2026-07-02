# Implementation Roadmap

This document defines the order of implementation for Augur and the acceptance bar for each phase. Phases are sequential; a phase starts only when the previous phase's acceptance criteria are met.

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
- ST-001 through ST-011 pass at the engine level (no HTTP involved; ST-012 requires Phase 4).

## Phase 2 — HTTP API

Scope:

- HTTP server exposing `POST /v1/plans` and `GET /v1/health` per the [HTTP API](./interface/http-api.md) spec.
- Request validation returning `400` with the documented error shape.
- Safety tests proving the service never shells out or touches application code.

Acceptance:

- API tests pass against a running server instance.
- The local startup flow in [Local Development Setup](./setup/local-development.md) works end to end.

## Phase 3 — CLI Interface

Scope:

- An `augur plan` command that gathers local signals (git diff, changed files, optional log/coverage files) and prints a plan, reusing the Phase 1 engine directly.
- Output formats: human-readable text and `--json` for agents.

Acceptance:

- A new `spec/interface/cli.md` is written before implementation starts.
- The CLI produces the same plan as the HTTP API for the same input.

## Phase 4 — LLM Assistance

Scope:

- The optional prose enrichment stage defined in the [Planning Engine](./feature/planning-engine.md) spec.
- LLM exemption proposals: semantic judgment of which scopes a UX budget should not strictly cover (for example, login and registration flows), emitted as labeled `ExperienceExemption` proposals.
- Provider abstraction behind `AUGUR_LLM_PROVIDER` / `AUGUR_LLM_API_KEY`.

Acceptance:

- With LLM assistance disabled, all golden tests still pass unchanged.
- Tests prove prose enrichment cannot alter structural fields.
- ST-012 passes: LLM-proposed exemptions are labeled, never delete guardrails, and never override caller-explicit targets.

## Phase 5 — Persistence and History

Scope:

- Optional storage of issued plans (`planId`, `createdAt` added to `PlanResponse` as optional fields).
- `GET /v1/plans/{id}` for retrieval.

Acceptance:

- Schema additions are backward compatible: existing clients ignore the new optional fields.
- The [Core Data Schema](./data/core-schema.md) is updated before implementation starts.

## Non-Goals

These stay out of scope for all phases above:

- Executing tests or any shell command on behalf of the caller.
- Generating or applying code patches.
- Repository crawling; Augur only sees what a request supplies.
