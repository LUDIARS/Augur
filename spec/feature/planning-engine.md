# Planning Engine

## Purpose

This spec defines how Augur turns a `CreatePlanRequest` into a `PlanResponse`.

It records the core design decision for the MVP: **planning is a deterministic, rule-based pipeline**. LLM assistance is an optional enrichment stage that is disabled by default and can never change the structural shape of a plan.

## Design Decision: Deterministic Core

The MVP planning engine must be deterministic:

- The same request always produces the same response.
- No randomness, wall-clock time, or environment-dependent values may influence output.
- Identifiers (`ev-001`, `test-001`, `fix-001`, `risk-001`) are assigned sequentially in a stable order.

Rationale:

- Golden tests in the [Service Test Strategy](../test/service-test-strategy.md) require stable output.
- Callers (especially AI coding agents) need reproducible guidance to debug their own workflows.
- A deterministic core keeps the MVP free of API keys, network dependencies, and cost.

## Pipeline

The engine runs six stages in order:

1. **Validate** — reject structurally invalid requests (see [HTTP API](../interface/http-api.md) error handling). Missing optional signals are not errors.
2. **Normalize** — parse raw signals into uniform internal facts: split diffs per file, extract stack frames from failure logs, parse coverage content by its declared format, and tag runtime signals. Experience goals are resolved into concrete budgets and applicable scopes here, per [Experience-Driven Constraints](./experience-driven-constraints.md).
3. **Extract evidence** — convert each normalized fact into an `Evidence` entry. Every downstream suggestion, fix step, and risk must trace back to entries created here.
4. **Apply objective rules** — select the rule module for `objective.kind`. The module produces candidate `TestSuggestion`s and a `FixPolicy` skeleton following the mappings in [Purpose-Driven Test Plan](./purpose-driven-test-plan.md) and [Purpose-Driven Fix Policy](./purpose-driven-fix-policy.md).
5. **Score and rank** — assign `priority` and `confidence` to each candidate, drop candidates below the confidence floor, and order the survivors.
6. **Assemble** — assign stable ids, link evidence, and generate the plan `summary`.

## Rule Modules

Each objective kind is implemented as an isolated rule module with a shared interface:

- Input: the normalized facts and extracted evidence.
- Output: candidate suggestions and a fix policy skeleton.
- A module must not read raw request fields directly; it only sees normalized facts.

This keeps objective behavior independently testable and lets new objective kinds be added without touching existing modules.

## Scoring Rules

`priority` reflects impact if the suggestion is skipped; `confidence` reflects evidence strength (see the bands in the [Core Data Schema](../data/core-schema.md)).

Confidence is computed as:

- a base value defined by the rule that produced the candidate,
- increased by a fixed boost for each independent corroborating evidence type (for example, a failure log **and** a diff touching the same file),
- capped at `1.0`.

Candidates whose confidence falls below `0.2` are dropped unless the plan would otherwise be empty, in which case the engine emits investigation-first guidance instead of an empty plan.

## Graceful Degradation

- Objective-only input still yields a plan built from objective evidence alone, with low confidence values.
- Conflicting signals (for example, a passing exit code alongside an error log) are surfaced as a `Risk` rather than resolved silently.
- Unparseable signal content (for example, malformed coverage data) downgrades to `format: "unknown"` handling and is noted as evidence with reduced weight, never a request failure.

## LLM Assistance (Future, Optional)

A later phase may add LLM assistance with exactly two permitted roles. It is controlled by `AUGUR_LLM_PROVIDER` / `AUGUR_LLM_API_KEY`, is disabled when they are unset, and golden and safety tests always run with it disabled.

### Role 1: Prose Enrichment

Runs **after** assembly:

- It may rewrite prose fields only: `summary`, `rationale`, `draft.description`, `draft.outline`, and step `description`s.
- It must not add, remove, or reorder suggestions, fix steps, risks, or evidence, and must not change ids, kinds, priorities, confidences, strategies, or budgets.

### Role 2: Exemption Proposal

Runs **during** normalization, only when experience goals are present:

- It judges semantically which scopes a quality does not need to cover strictly — for example, recognizing that login and registration flows do not carry a 20ms responsiveness expectation — and emits `ExperienceExemption` proposals labeled `proposedBy: "llm"`.
- Proposals are structured data fed back into the deterministic pipeline; the LLM never edits the plan directly. Given the same set of proposals, the rest of the pipeline remains deterministic.
- A proposal may downgrade a guardrail's priority and attach reasoning, but must never delete a guardrail or override a caller's explicit target or exemption. See [Experience-Driven Constraints](./experience-driven-constraints.md).
- Every applied proposal appears as `budget_exemption` evidence so the caller can audit and reject it.

## Constraints

- The engine must not execute shell commands or test runners.
- The engine must not read the caller's filesystem; it sees only what the request supplies.
- Stage boundaries are internal APIs and may change; the request/response schema is the public contract.

## Related Specs

- [Core Data Schema](../data/core-schema.md)
- [Experience-Driven Constraints](./experience-driven-constraints.md)
- [Purpose-Driven Test Plan](./purpose-driven-test-plan.md)
- [Purpose-Driven Fix Policy](./purpose-driven-fix-policy.md)
- [HTTP API](../interface/http-api.md)
- [Service Test Strategy](../test/service-test-strategy.md)
