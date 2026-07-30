# CLI

## Purpose

The CLI brings the Phase 1 engine to the developer's working directory: it gathers local signals (git state, log files, coverage, analyzer outputs), builds a `CreatePlanRequest`, calls `createPlan` directly, and prints the plan. No server required.

Since [Daemon-less CLI](../plan/daemonless-cli.md) (neco 2026-07-30) this is not merely "no server required" — **the CLI is Augur's only surface.** There is no Augur daemon and no port.

The engine boundary from the [Implementation Design](../implementation-design.md) holds: **only the CLI layer shells out** (to `git`) and reads files; the engine still receives data, never runs commands.

## Entry point

Other tools invoke Augur as `node <augurFolder>/bin/augur.mjs <subcommand>`, with no shell and no `PATH` assumption — the same shape Revisor already uses for `bin/anatomia.mjs`. The shim resolves `dist/cli/main.js` when a build is present, and otherwise imports `src/cli/main.ts`; when that import fails because Node before 22.18 does not strip types without the flag, it re-executes **itself** via `process.execPath` with `--experimental-strip-types`. The re-executed entry is the shim and not `src/cli/main.ts`, which only exports `main` — running the module directly would invoke nothing and exit `0` with no plan.

`package.json` also exposes it as the `augur` bin for local installs.

## Commands

```text
augur plan [options]           # this document
augur review-plan --json       # ./review-plan-cli.md
augur inject <...>             # ./inject-cli.md
```

`augur inject` is the existing log-injection tool, reached as a subcommand rather than as a second entry point. Future subcommands (e.g. `augur goals` to list the catalog) may be added without breaking these.

## Options

### Objective

| Option | Maps to | Notes |
| --- | --- | --- |
| `--kind <kind>` | `objective.kind` | one of the eight kinds; defaults to `unknown` |
| `--description <text>` | `objective.description` | required; also accepted as the positional argument. Giving both, or two positionals, names two descriptions and is a usage error rather than a silent choice between them |
| `--outcome <text>` | `objective.desiredOutcome` | optional |

### Signal gathering

| Option | Maps to | Behavior |
| --- | --- | --- |
| `--base <ref>` | `change.diff`, `change.changedFiles` | `git diff <ref>` and `git diff --name-only <ref>`; default base is `HEAD` (working tree changes). The value must name a ref: a leading `-` would reach `git` as an option and is a usage error |
| `--no-git` | — | skip git entirely (non-repo directories) |
| `--failure-log <file>` | `failure.stdout`/`stderr` | reads the file; `-` reads stdin, so `npm test 2>&1 \| augur plan --failure-log -` works |
| `--failure-command <cmd>` | `failure.command` | the command that produced the log |
| `--failure-exit <n>` | `failure.exitCode` | |
| `--coverage <file>` | `coverage` | format inferred from extension (`.info` → lcov, `.json` → json, else text) |
| `--signals <file.json>` | `runtimeSignals` | JSON array of `RuntimeSignal`s — latency measurements, `media_analysis` analyzer outputs, anything the schema accepts |
| `--goals <file.json>` | `experienceGoals` | JSON array of `ExperienceGoal`s with targets and exemptions |
| `--quality <q>` | `experienceGoals` | shorthand for an abstract goal (repeatable); merged with `--goals`. Checked against the quality catalog like `--kind` and `--domain`, so a typo names the flag rather than a request field the caller never wrote |

### Project context

| Option | Maps to | Behavior |
| --- | --- | --- |
| `--domain <d>` | `project.domain` | `web` / `game` / `service` / `other` |
| (automatic) | `project.*` | when `package.json` exists: `name`, `packageManager`, and `testRunners` inferred from known devDependencies (vitest, jest, playwright, cypress); inference is best-effort and always overridable via `--project <file.json>` |

### Pre-assembled requests

| Option | Behavior |
| --- | --- |
| `--request <file>` | read a complete `CreatePlanRequest` and skip signal gathering; `-` reads stdin |

This is the direct replacement for `POST /v1/plans` ([Daemon-less CLI](../plan/daemonless-cli.md)). A caller that already built the request — Anatomia's Test Suggestions bridge is the one that exists — must not have Augur re-derive anything from a working directory it does not own, so `--request` is mutually exclusive with every gathering flag and with `--no-git`; combining them is a usage error (exit `1`). Validation failures produce the same message the HTTP `400` envelope carried.

### Output

| Option | Behavior |
| --- | --- |
| `--json` | print the `PlanResponse` JSON verbatim — the agent-facing format |
| `--out <file>` | write the output to a file instead of stdout |
| (default) | human-readable text, described below |

## Text Output Format

```text
Augur plan — bug_fix
Summary: Lead with "Regression test reproducing: ..." (high), then write the failing test first, then fix.

Tests
  [critical] ...
  [high]     Regression test reproducing: stale search results   (regression, 0.90)
             -> Given existing results, when the query becomes empty, ...
             evidence: ev-001, ev-003

Fix policy: test_first
  1. Add failing regression coverage            [ev-001, ev-003]
  2. Reset result state for empty query         (after 1)

Risks
  [medium] Reset behavior may affect consumers ...

Evidence
  ev-001 objective     Caller requested bug fix: ...
  ev-003 failure_log   npm run test exited with code 1: ...
```

Rules:

- Suggestions grouped by priority, preserving engine order; budget-carrying suggestions show the budget inline (`api_latency p95 <= 20ms`).
- Proposed budgets are marked `(proposed)` so the label from [Experience-Driven Constraints](../feature/experience-driven-constraints.md) survives into the terminal.
- The text format is presentation only: `--json` is the compatibility surface; text layout may change without notice.

## Exit Codes

- `0` — plan produced.
- `1` — usage or validation error (bad flags, invalid signals file); message on stderr mirrors the HTTP `400` message.
- `2` — unexpected internal error.

A plan whose suggestions include `critical` items still exits `0`: producing the plan is the CLI's job; enforcement belongs to the tests it proposes. A `--fail-on <priority>` flag (exit `3` when the plan contains suggestions at or above the given priority) is reserved for CI gating but not part of Phase 3.

## Relationship to the engine

The CLI calls `createPlan` directly and performs no planning logic of its own; flags only *assemble the request*. Golden tests on `createPlan` are what hold the contract.

The former CLI↔HTTP parity test is superseded by [Daemon-less CLI](../plan/daemonless-cli.md): there is one surface, so there is no parity to prove. [HTTP API](./http-api.md) is retained as the `CreatePlanRequest`/`PlanResponse` reference — the schema outlives the transport.

## Constraints

- The CLI reads git and local files to build the request; it never executes tests, never mutates the repository, and never sends anything over the network.
- Signal gathering failures degrade gracefully: an unreadable coverage file becomes a warning on stderr and the plan proceeds without that signal, mirroring the engine's graceful-degradation rules.
- `--json` output goes to stdout with nothing else on stdout, so pipelines can consume it directly.

## Related Specs

- [Core Data Schema](../data/core-schema.md)
- [Planning Engine](../feature/planning-engine.md)
- [Review Plan CLI](./review-plan-cli.md)
- [Daemon-less CLI](../plan/daemonless-cli.md)
- [HTTP API](./http-api.md) — superseded transport, retained as schema reference
- [Implementation Design](../implementation-design.md)
- [Roadmap](../roadmap.md) — Phase 3
