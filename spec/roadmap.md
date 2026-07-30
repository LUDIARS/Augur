# Implementation Roadmap

This document defines the order of implementation for Augur and the acceptance bar for each phase. Phases are sequential; a phase starts only when the previous phase's acceptance criteria are met.

Technology choices, module layout, and internal interfaces for these phases are defined in the [Implementation Design](./implementation-design.md).

Status: design is complete for all phases. Phases 0–2 are implemented; Phases 3–6 are designed ([CLI](./interface/cli.md), [LLM Assistance](./feature/llm-assistance.md), [Plan Persistence](./data/persistence.md), [Daemon-less CLI](./plan/daemonless-cli.md)) and not yet implemented.

**Phase 2 is superseded (neco 2026-07-30).** Augur ships as a daemon-less CLI:
Phase 3 becomes the delivery surface, and the HTTP server is removed in Phase 6.
See [Daemon-less CLI](./plan/daemonless-cli.md).

One exception to the sequential rule follows from that decision: Phase 6 depends
only on Phase 3 being complete, not on Phases 4 and 5, so the daemon can be
removed as soon as the CLI replaces it.

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

## Phase 2 — HTTP API (superseded)

Implemented, then superseded by [Daemon-less CLI](./plan/daemonless-cli.md).
Retained as the record of what exists in `main` until Phase 6 removes it.

Scope:

- HTTP server exposing `POST /v1/plans` and `GET /v1/health` per the [HTTP API](./interface/http-api.md) spec.
- Request validation returning `400` with the documented error shape.
- Safety tests proving the service never shells out or touches application code.

Acceptance:

- API tests pass against a running server instance.
- The local startup flow in [Local Development Setup](./setup/local-development.md) works end to end.

## Phase 3 — CLI Interface (the delivery surface)

Design: [CLI](./interface/cli.md), [Review Plan CLI](./interface/review-plan-cli.md),
[Daemon-less CLI](./plan/daemonless-cli.md) step A1.

Scope:

- `bin/augur.mjs`, invocable as `node <augurFolder>/bin/augur.mjs <subcommand>`
  with no shell and no `PATH` assumption.
- An `augur plan` command that gathers local signals (git diff, changed files, optional log/coverage/analyzer files) and prints a plan, reusing the Phase 1 engine directly.
- An `augur plan --request -` mode that reads a complete `CreatePlanRequest` on
  stdin and skips signal gathering — the direct replacement for `POST /v1/plans`,
  required by Anatomia's Test Suggestions bridge.
- An `augur review-plan` command that reads a change profile on stdin and writes
  stage and test-case decisions on stdout, for Revisor's review planning.
- `augur inject` as a subcommand of the same entry point.
- Output formats: human-readable text and `--json` for agents.

Acceptance:

- The CLI implements the flag surface, exit codes, and gathering behavior in the CLI spec.
- `augur review-plan` satisfies the request/response contract and the exit-code
  behaviour in [Review Plan CLI](./interface/review-plan-cli.md); a non-zero exit
  leaves the caller's deterministic plan in force.
- Golden tests on `createPlan` are unchanged by the new surface.

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

**Blocked on a revision.** This phase assumed an HTTP layer to stamp plan ids and
to expose the store. With the daemon removed, the CLI stamps the id and the store
is reached by subcommand, not by route. [Plan Persistence](./data/persistence.md)
needs rewriting before Phase 5 starts; the decision itself is not blocked. The
route wording in the scope below is HTTP-era and is rewritten with that spec.

Scope:

- Optional storage of issued plans behind the `PlanStore` interface (SQLite file store, in-memory store for tests), off by default.
- Retrieval and deletion of a stored plan by id, with retention sweep (written as
  `GET`/`DELETE /v1/plans/{planId}` in the HTTP-era spec; reached by subcommand
  once that spec is revised).

Acceptance:

- With persistence disabled, plans are byte-identical to the Phase 1 engine output.
- Store contract tests pass against both store implementations; delete-then-get reports "not found".

## Phase 6 — Daemon Removal

Design: [Daemon-less CLI](./plan/daemonless-cli.md) step A3.

Scope:

- Delete `src/server.ts`, `src/app.ts`, `src/routes/`.
- Drop `hono`, `@hono/node-server`, and `pino`; diagnostics go to stderr.
- Replace `npm start` with the CLI entry point.
- Remove `test/api/` and rewrite the startup flow in
  [Local Development Setup](./setup/local-development.md) around the CLI.
- Remove the `augur` service entry from the Excubitor catalog and the port from
  the LUDIARS service map. Both are changes to other repositories and are
  required follow-ups outside this one.

Acceptance:

- No code path creates a listener; no `hono`, no `AUGUR_PORT`, and no port
  binding remain in this repository.
- The engine's golden tests are unchanged by the removal.
- Phase 3 must be complete first: the CLI is the replacement, not a parallel
  surface.
- **Anatomia's Test Suggestions bridge must already be migrated off the HTTP API
  (step A2b).** It is the only HTTP caller and it is a shipped feature; removing
  the server before it moves breaks the Anatomia web dashboard.

## Non-Goals

These stay out of scope for all phases above:

- Executing tests or any shell command on behalf of the caller.
- Generating or applying code patches.
- Repository crawling; Augur only sees what a request supplies.
