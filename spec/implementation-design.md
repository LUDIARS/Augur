# Implementation Design

This document defines how the specs translate into code: technology choices, module layout, key internal interfaces, and the conventions that keep the [Planning Engine](./feature/planning-engine.md) deterministic. The request/response schema in [Core Data Schema](./data/core-schema.md) is the public contract; everything here is internal and may evolve.

## Technology Choices

| Concern | Choice | Rationale |
| --- | --- | --- |
| Runtime | Node.js (current LTS) | matches [Local Development Setup](./setup/local-development.md) |
| Language | TypeScript, `strict` mode | schema-heavy domain; the type system carries the spec |
| Schema validation | Zod schemas as the single source of truth; TS types inferred from them | one definition serves validation (HTTP 400s) and typing |
| HTTP server | ~~Hono + @hono/node-server~~ — **removed in Phase 6** | superseded by [Daemon-less CLI](./plan/daemonless-cli.md); Augur has no daemon |
| Test runner | Vitest | per [Service Test Strategy](./test/service-test-strategy.md) |
| Logging | ~~pino~~ → stderr writes from the CLI layer | the engine itself stays pure; a CLI has no log pipeline to feed |

## Module Layout

```text
bin/
  augur.mjs         # the entry other tools invoke (node bin/augur.mjs <subcommand>);
                    # resolves dist/cli/main.js, else re-execs with --experimental-strip-types
src/
  server.ts         # kept (Phase 6 withdrawn): config load, pino logger, loopback serve — reached as `augur serve`
  app.ts            # Hono app assembly (/v1/plans, /v1/health, /v1/tests/*)
  config/           # augur.config.json loader (port, buses, repositories, runCache, authoring, dataDir)
  routes/           # HTTP boundary, zod -> 400 mapping
    tests.ts        #   /v1/tests/* (spec/interface/tests-api.md) — thin over operations/
  schema/           # Zod schemas mirroring spec/data/core-schema.md, one export per type
  catalog/          # experience goal catalog as data
    common.ts       #   EG-Cxx entries
    web.ts          #   EG-Wxx entries
    game.ts         #   EG-Gxx entries
    index.ts        #   lookup by quality, domain filtering
  engine/           # one module per pipeline stage, single files while each stays single-responsibility
    normalize.ts    # signal parsing: diff, failure, coverage, runtime (includes budget resolution)
    experience.ts   # goal resolution, exemption application, budget comparison
    experienceSuggestions.ts  # budget guardrail suggestions
    focusedTesting.ts # analyzer-provided domain/variable priority -> deterministic candidates
    evidence.ts     # facts -> Evidence[], stable ordering and ids
    rules/          # one module per objective kind: bugFix.ts, refactor.ts, ...
    scoring.ts      # priority + confidence rules, confidence floor
    assemble.ts     # id assignment, evidence linking, summary generation
    createPlan.ts   # the pipeline: (CreatePlanRequest) => PlanResponse, pure
  inject/           # log injection framework (spec/feature/log-injection.md), reached as `augur inject`
  llm/              # Phase 4 only: provider abstraction, enrich.ts, proposeExemptions.ts (spec/feature/llm-assistance.md)
  cli/              # Phase 3 — the delivery surface (spec/interface/cli.md)
    main.ts         #   argv dispatch across subcommands
    plan.ts         #   `augur plan`
    reviewPlan.ts   #   `augur review-plan` (spec/interface/review-plan-cli.md)
    gather.ts       #   git and local-file signal gathering — the only place that shells out
    format.ts       #   text and --json rendering
    tests/          #   `augur tests <verb>` (spec/interface/tests-cli.md), one file per verb, thin over operations/
  store/            # Phase 5 only: PlanStore interface, sqlite + memory implementations (spec/data/persistence.md)
  operations/       # T3: the one operations layer CLI / HTTP / MCP share (spec/interface/tests-api.md §1)
    tests.ts        #   TestOperations: listTests, catalog, plan, author, run, report, verdict, flag, listRuns
  tests/            # T1/T2: test lifecycle (spec/feature/test-lifecycle.md, test-authoring.md, data/test-registry.md)
    registry.ts     #   .augur/tests.jsonl load/save/upsert, history-field protection
    config.ts       #   .augur/tests.config.json (quota, runners, retirement, impact, layout)
    bundle.ts       #   deterministic bundle selection (pr / domain / all / ids) with reasons
    run.ts          #   run orchestration: bundle -> runner invocations -> bus -> RunRecord
    run-store.ts    #   RunStore interface, sqlite (node:sqlite) + jsonl implementations, retention sweep
    retirement.ts   #   active -> probation -> retired under --now
    report.ts       #   text / json / markdown report for the judge
    flag.ts         #   Revisor external verification client (spec/interface/revisor-verification.md)
    runners/        #   Runner interface; vitest.ts (json reporter), command.ts (exit code), presets for cargo/gtest/unity
    anatomia.ts     #   spawn of the Anatomia CLI (pr-review / domains program / callers), AUGUR_ANATOMIA_DIR
    plan/           #   T2: plan.ts, targets.ts, priority.ts, quota.ts, briefs.ts, incident.ts
    author/         #   T2: author.ts, session.ts (briefs only), claude-cli.ts (claude -p, pinned model), write.ts
  bus/              # T1: Bus interface; local.ts (spawn, no shell), wrapper.ts (argv template, env allow-list)
  mcp/              # T3: `augur mcp` stdio server, tools 1:1 with operations
test/
  tests/            # T1–T3: registry round-trip, bundle/retirement determinism, runner parsing, bus no-shell, operations parity
  unit/             # engine internals per module, config loader
  golden/           # cases/*.json request/response pairs
  cli/              # subcommand behaviour: flag surface, exit codes, stdout discipline
  api/              # in-process Hono app tests (/v1/plans and /v1/tests/*)
  safety/           # no-exec, no-fs-mutation guarantees (engine purity + shell no-spawn)
```

Dependency direction is one-way: `cli` / `routes` / `mcp` → `operations` → `tests` → `bus`, and `cli` → `engine` → `catalog`/`schema`. `tests/plan` may call `engine` (guardrail targets) but `engine` never imports from `tests`. The engine imports nothing from `cli` or `llm`; LLM assistance plugs in through interfaces defined by the engine (see below). This layout is mirrored by `spec/design.md` I-3; update both together.

`reviewPlan.ts` maps a caller's change profile onto a `CreatePlanRequest` and
reduces the resulting plan to stage decisions. **The engine gains no knowledge of
review stages**: that vocabulary belongs to the caller and stays in the CLI layer.

## Key Interfaces

### The engine entry point

```ts
// engine/createPlan.ts
function createPlan(request: CreatePlanRequest, options?: PlanOptions): PlanResponse;

type PlanOptions = {
  // Phase 4: pre-computed LLM exemption proposals, fed in from outside.
  // The engine itself never calls the network.
  proposedExemptions?: ExperienceExemption[];
};
```

`createPlan` is a pure, synchronous function. All IO (HTTP parsing, LLM calls, file reads) happens outside it. This is what makes ST-007 (byte-identical output) testable at the function level and keeps the LLM boundary honest: assistance produces *inputs* to the engine, never edits to its output — except prose enrichment, which wraps the result afterward.

### Normalized facts

```ts
// engine/normalize/
type NormalizedFacts = {
  objective: Objective;
  changedFiles: ChangedFileFact[];
  failures: FailureFact[];        // parsed stack frames, exit codes
  coverage: CoverageFact | null;  // unified regardless of input format
  runtime: RuntimeFact[];         // unit-tagged measurements with scope
  budgets: ResolvedBudget[];      // experience goals resolved to concrete targets
  focusedDomains: FocusedDomain[]; // analyzer facts; no engine-side source inspection
  constraints: PlanningConstraint[];
};

type ResolvedBudget = {
  quality: ExperienceGoal["quality"];
  target: ExperienceTarget;
  proposed: boolean;                       // true when filled from catalog defaults
  exemption?: ExperienceExemption;         // the exemption governing this scope, if any
  violations: RuntimeFact[];               // matching signals that exceed the target
};
```

Rule modules read facts, never the raw request — the isolation requirement from the Planning Engine spec is enforced by this type boundary.

### Rule modules

```ts
// engine/rules/
interface RuleModule {
  kind: Objective["kind"];
  plan(facts: NormalizedFacts, evidence: EvidenceIndex): RuleOutput;
}

type RuleOutput = {
  suggestions: CandidateSuggestion[]; // no ids yet; scoring not yet applied
  fixSkeleton: FixPolicySkeleton;
};
```

A registry maps every objective kind to exactly one module; a unit test asserts the registry is total. Adding an objective kind = adding one file plus its registry entry.

### Catalog entries

```ts
// catalog/
type CatalogEntry = {
  id: string;                        // "EG-C01"
  quality: ExperienceGoal["quality"];
  domain: "common" | "web" | "game";
  keyResults: CatalogKeyResult[];    // { id: "KR-C01a", target: ExperienceTarget }
  patterns: CatalogTestPattern[];    // { id: "TP-C01-1", kind, titleTemplate, draftTemplate }
  typicalExemptions: string[];
};
```

The [Experience Goal Catalog](./data/experience-goal-catalog.md) is the spec; `src/catalog/` is its executable mirror. Two consistency tests guard the mirror: every `quality` union member except `custom` has exactly one entry, and every entry id appears in the catalog document (a plain-text scan — cheap and effective).

### Id assignment and determinism

- Ids (`ev-001`, `test-001`, `fix-001`, `risk-001`) come from a counter passed through assembly — never from globals, time, or randomness.
- Evidence ordering is fixed: objective → change → failure → coverage → runtime → experience goals → exemptions → violations. Within a category, input order is preserved.
- An ESLint rule (`no-restricted-globals` / `no-restricted-syntax`) bans `Date.now`, `new Date()`, and `Math.random` inside `src/engine/` and `src/catalog/`.
- Suggestion ordering: priority band first, then confidence descending, then stable insertion order as the tiebreak.

## HTTP Layer (superseded in Phase 6)

The route rules below describe what exists in `main` today; they are removed with
the server per [Daemon-less CLI](./plan/daemonless-cli.md). The CLI keeps the same
validation contract, mapping a Zod parse failure to exit `1` with the documented
message on stderr instead of a `400` envelope.

- One Hono route per endpoint in [HTTP API](./interface/http-api.md); handlers do parse → `createPlan` → serialize, nothing else.
- Zod parse failures map to the documented `400` envelope with the first issue path in the message (`"objective.description is required"`).
- Unexpected exceptions map to the `500` envelope; the error is logged, the response body never leaks internals.
- A run holds no state between invocations (MVP has no persistence — [roadmap](./roadmap.md) Phase 5 revisits this). This is precisely why no daemon is needed: see [Daemon-less CLI](./plan/daemonless-cli.md).

## LLM Boundary (Phase 4)

```ts
// llm/
interface LlmProvider {
  complete(prompt: string, options: { json?: boolean }): Promise<string>;
}

// Role 2 — runs BEFORE the engine, produces engine input:
function proposeExemptions(request: CreatePlanRequest, provider: LlmProvider): Promise<ExperienceExemption[]>;

// Role 1 — runs AFTER the engine, rewrites prose only:
function enrichProse(plan: PlanResponse, provider: LlmProvider): Promise<PlanResponse>;
```

`enrichProse` is followed by a structural-equality assertion in code (not just in tests): the enriched plan is diffed against the original with prose fields masked, and any structural difference throws, discarding the enrichment. This makes the "prose only" rule from the Planning Engine spec self-enforcing at runtime.

Proposal labeling is forced by construction: `proposeExemptions` stamps `proposedBy: "llm"` on everything it returns, and the engine rejects unlabeled proposals arriving via `PlanOptions.proposedExemptions`.

## Test Implementation Notes

- **Golden tests**: each case is a directory-free pair `test/golden/cases/<name>.json` holding `{ request, expected }`. The test runs `createPlan(request)` and deep-equals against `expected`. Regenerating expectations is an explicit script (`npm run golden:update`), never automatic.
- **Safety tests**: `child_process` and `fs` write methods are stubbed with throwing spies for the whole engine test suite — any engine code path that shells out or writes fails loudly. This implements the "never invokes test runner commands" constraint as a test, not a convention.
- **CLI tests**: subcommands are invoked in-process through `main.ts`'s argv dispatch with stdin/stdout captured — no child process, no port — so flag surface, exit codes, and stdout discipline stay fast to assert. (The Phase 2 API tests used Hono's `app.request()`; they go away with the server.)
- **Catalog consistency tests**: as described under Catalog entries.

## Resolved Decisions

Formerly open; each is now specified in its phase design:

- Diff parsing depth (Phase 1): file-level granularity, implemented; hunk-level only if a rule needs it.
- CLI signal gathering (Phase 3): flags, gathering behavior, and exit codes are defined in the [CLI](./interface/cli.md) spec; only the CLI layer shells out to `git`.
- LLM assistance (Phase 4): provider abstraction, role contracts, failure handling, and privacy rules are defined in [LLM Assistance](./feature/llm-assistance.md); single provider first, the interface is the commitment.
- Persistence (Phase 5): `PlanStore` interface, `PlanRecord` shape, id stamping, and retention are defined in [Plan Persistence](./data/persistence.md). That spec still assumes an HTTP layer stamps the id and needs rewriting for the CLI before Phase 5 starts.

## Related Specs

- [Core Data Schema](./data/core-schema.md)
- [Experience Goal Catalog](./data/experience-goal-catalog.md)
- [Plan Persistence](./data/persistence.md)
- [Planning Engine](./feature/planning-engine.md)
- [Experience-Driven Constraints](./feature/experience-driven-constraints.md)
- [LLM Assistance](./feature/llm-assistance.md)
- [HTTP API](./interface/http-api.md)
- [CLI](./interface/cli.md)
- [Review Plan CLI](./interface/review-plan-cli.md)
- [Daemon-less CLI](./plan/daemonless-cli.md)
- [Service Test Strategy](./test/service-test-strategy.md)
- [Roadmap](./roadmap.md)
