# Implementation Roadmap

This document defines the order of implementation for Augur and the acceptance bar for each phase. Phases are sequential; a phase starts only when the previous phase's acceptance criteria are met.

Technology choices, module layout, and internal interfaces for these phases are defined in the [Implementation Design](./implementation-design.md).

Status: design is complete for all phases. Phases 0–3 are implemented; Phases 4–5 are designed ([LLM Assistance](./feature/llm-assistance.md), [Plan Persistence](./data/persistence.md)) and not yet implemented. Phase 6 (daemon removal) is **withdrawn** and replaced by the daemon-optional test-management phases T1–T4 below ([Test Management](./plan/test-management.md), neco 2026-08-23).

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

## Phase 3 — CLI Interface (the delivery surface) — implemented

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

**Revised for the CLI (neco 2026-07-31).** This phase assumed an HTTP layer to
stamp plan ids and expose the store. With the daemon removed, the CLI stamps the
id and the store is reached by subcommand (`augur plans get|delete`).
[Plan Persistence](./data/persistence.md) is rewritten accordingly; the
`PlanStore` interface, the `PlanRecord` shape and the retention rules were
unaffected.

Scope:

- Optional storage of issued plans behind the `PlanStore` interface (SQLite file store, in-memory store for tests), off by default.
- Retrieval and deletion of a stored plan by id (`augur plans get|delete <planId>`), with retention sweep.

Acceptance:

- With persistence disabled, plans are byte-identical to the Phase 1 engine output.
- Store contract tests pass against both store implementations; delete-then-get reports "not found".

## Phase 6 — Daemon Removal (withdrawn, neco 2026-08-23)

Superseded by [Test Management](./plan/test-management.md) §1.2: Augur is
**daemon-optional**. The CLI stays the canonical surface, `augur mcp` is stdio,
and the existing Hono shell is kept as the opt-in `augur serve`. Step A2b
(Anatomia bridge → CLI) is done and stays; step A3 (`chore/remove-daemon`) is
not merged. The original scope is kept below as the record of what was planned.

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

## Phases T1–T4 — Test Management

Design: [Test Management](./plan/test-management.md) and the six specs it lists.
These phases add test authoring, a test registry, bundled execution over a
configurable bus, a run cache, staged retirement, an HTTP/MCP surface, and the
verification flag to Revisor. Dependencies: T2 and T3 depend on T1; T4 is a
Revisor-side change and is independent.

| Phase | Scope | Acceptance |
| --- | --- | --- |
| T1 registry / bus / run / cache | `src/tests/`, `src/bus/`, `augur tests list\|register\|lint\|run\|report\|verdict\|flag\|runs\|sweep\|revive\|prune` | Registry round-trips byte-identically; bundle selection and retirement are deterministic under `--now`; `local` and `wrapper` buses run vitest and `command` runners without a shell; run cache honours retention |
| T2 plan / author | `augur tests plan\|author`, Anatomia `pr-review` / `domains program` / `callers` intake, quota, incident intake, `session` and `claude-cli` authors | `blocked_by_domain` on unclassified anchors; same analysis + registry + config → same plan; quota replacement picks the oldest probation test; incident tests fail before the fix and pass after when `--before` is given |
| T3 API / MCP | `augur serve` routes under `/v1/tests`, `augur mcp` (stdio), shared `src/operations/` | Every CLI verb maps to one operation; HTTP and MCP return the same JSON as `--json`; writes are loopback-only; concurrent runs on one worktree return 409 |
| T4 Revisor flag | Revisor repository: `POST /api/local-prs/:id/verification`, derived effects in disposition / merge-risk / board | See [Revisor verification](./interface/revisor-verification.md) §5 |

## Phases C1–C5 — Live Contract Testing

Design: [契約プログラミングによる委託受け入れとオンライブテスト](./plan/2026-09-05-live-contract-testing.md).
Acceptance criteria for delegated work are written as contracts (pre / post /
invariant), a marker-tagged `contract-wrap` injection rule wraps the newly
implemented functions, and `augur contracts report` turns the weaver events those
wrappers emit into the `covered / violated / uncovered` material behind a verdict.
The wrapper only observes — synchronous results/errors and asynchronous settlements pass through unchanged — and
`augur inject remove` restores the source byte-for-byte.

| Phase | Repository | Scope | Depends on |
| --- | --- | --- | --- |
| C1 runtime | Lapilli | `contract()` in `@ludiars/log-weaver` (observe / enforce, sample) | — |
| C2 contracts + injection | Augur | `augur.contracts.json`, `augur contracts lint`, inject rule `contract-wrap`, Anatomia `--diff-base` matching | C1 types |
| C3 aggregation | Augur | `augur contracts report` (`--acceptance`), `tests report` contracts section, flag summary | C2 |
| C4 delegation | Concordia | contract-style acceptance criteria in templates, completion-evidence cross-check | C3 |
| C5 display | Revisor | accept and show `summary.contracts` on local PRs | C3 |

## Non-Goals

These stay out of scope for all phases above:

- Being a test framework. Augur runs the target repository's own runners over a
  bus and records the outcome; it never bundles vitest, cargo, or gtest itself.
- Executing anything outside a configured bus, or through a shell.
- Generating or applying code patches other than test files written by
  `augur tests author` under the rules in [Test Authoring](./feature/test-authoring.md) §5.3.
- Repository crawling; planning only sees Anatomia facts, the registry, and the
  repository's `.augur/` configuration.
