# Implementation Design

This document defines how the specs translate into code: technology choices, module layout, key internal interfaces, and the conventions that keep the [Planning Engine](./feature/planning-engine.md) deterministic. The request/response schema in [Core Data Schema](./data/core-schema.md) is the public contract; everything here is internal and may evolve.

## Technology Choices

| Concern | Choice | Rationale |
| --- | --- | --- |
| Runtime | Node.js (current LTS) | matches [Local Development Setup](./setup/local-development.md) |
| Language | TypeScript, `strict` mode | schema-heavy domain; the type system carries the spec |
| Schema validation | Zod schemas as the single source of truth; TS types inferred from them | one definition serves validation (HTTP 400s) and typing |
| HTTP server | Fastify | schema-first validation hooks, small surface |
| Test runner | Vitest | per [Service Test Strategy](./test/service-test-strategy.md) |
| Logging | pino, silent by default in the engine | the engine itself stays pure |

## Module Layout

```text
src/
  schema/           # Zod schemas mirroring spec/data/core-schema.md, one export per type
  catalog/          # experience goal catalog as data
    common.ts       #   EG-Cxx entries
    web.ts          #   EG-Wxx entries
    game.ts         #   EG-Gxx entries
    index.ts        #   lookup by quality, domain filtering
  engine/
    normalize/      # one parser per signal: diff.ts, failure.ts, coverage.ts, runtime.ts
    experience/     # goal resolution, exemption application, budget comparison
    evidence/       # facts -> Evidence[], stable ordering and ids
    rules/          # one module per objective kind: bugFix.ts, refactor.ts, ...
    scoring/        # priority + confidence rules, confidence floor
    assemble/       # id assignment, evidence linking, summary generation
    createPlan.ts   # the pipeline: (CreatePlanRequest) => PlanResponse, pure
  llm/              # Phase 4 only: provider abstraction, enrich.ts, proposeExemptions.ts
  http/             # Fastify app: routes, zod -> 400 mapping, error envelope
  cli/              # Phase 3 only
test/
  unit/             # engine internals per module
  golden/           # cases/*.json request/response pairs
  api/              # HTTP-level tests against an in-process server
  safety/           # no-exec, no-fs-mutation guarantees
```

Dependency direction is one-way: `http`/`cli` → `engine` → `catalog`/`schema`. The engine imports nothing from `http`, `cli`, or `llm`; LLM assistance plugs in through interfaces defined by the engine (see below).

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

## HTTP Layer

- One Fastify route per endpoint in [HTTP API](./interface/http-api.md); handlers do parse → `createPlan` → serialize, nothing else.
- Zod parse failures map to the documented `400` envelope with the first issue path in the message (`"objective.description is required"`).
- Unexpected exceptions map to the `500` envelope; the error is logged, the response body never leaks internals.
- The server holds no state between requests (MVP has no persistence — [roadmap](./roadmap.md) Phase 5 revisits this).

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
- **API tests**: Fastify's `inject()` (in-process, no port) keeps them fast and CI-friendly.
- **Catalog consistency tests**: as described under Catalog entries.

## Open Decisions

Deferred until their phase starts, with the current lean noted:

- Diff parsing depth (Phase 1): start with file-level granularity; hunk-level only if a rule needs it.
- CLI signal gathering (Phase 3): shell out to `git` from the CLI layer only — the engine still receives data, never runs commands.
- LLM provider set (Phase 4): start with a single provider behind `LlmProvider`; the interface is the commitment, not the vendor.

## Related Specs

- [Core Data Schema](./data/core-schema.md)
- [Experience Goal Catalog](./data/experience-goal-catalog.md)
- [Planning Engine](./feature/planning-engine.md)
- [Experience-Driven Constraints](./feature/experience-driven-constraints.md)
- [HTTP API](./interface/http-api.md)
- [Service Test Strategy](./test/service-test-strategy.md)
- [Roadmap](./roadmap.md)
