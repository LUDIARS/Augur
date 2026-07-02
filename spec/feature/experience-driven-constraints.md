# Experience-Driven Constraints

## Purpose

This spec defines Augur's flagship use case: turning abstract experience qualities into concrete, measurable budgets, and deriving test cases from them.

A caller can say either of these:

- Concrete: "the search endpoint must respond within 20ms."
- Abstract: "search should feel instant" / "the UI should feel responsive."

Both express the same underlying quality — responsiveness. Augur accepts both forms, resolves them into explicit numeric budgets, and produces guardrail test suggestions that external runners can enforce. Augur itself never measures anything.

## User Story

As a developer or AI coding agent,
I want to state how the product should feel — or give an exact budget when I have one,
so that Augur derives concrete, enforceable test cases from that feel without me hand-translating UX intent into thresholds.

## Concepts

Two layers connect UX intent to tests:

- **`ExperienceGoal`** — the abstract quality the caller wants ("responsiveness", "smoothness"). This is the vocabulary of product feel.
- **`ExperienceTarget`** — a concrete budget: metric, threshold, unit, and optionally a percentile and scope ("api_latency p95 ≤ 20ms on /search"). This is the vocabulary of tests.

A goal may arrive with explicit targets, or with none. Resolution rules below fill the gap.

A third concept controls where budgets do **not** apply:

- **`ExperienceExemption`** — a scope where the strict budget is waived or relaxed, with a reason ("login and registration are trust-building flows; users tolerate seconds there, 20ms does not apply").

All three types are defined in the [Core Data Schema](../data/core-schema.md).

## Quality-to-Metric Mapping

The canonical list of qualities — with their default budgets, typical exemptions, and test case patterns — lives in the [Experience Goal Catalog](../data/experience-goal-catalog.md). When a goal has no explicit targets, Augur proposes default budgets from that catalog. Defaults draw on established perception thresholds (about 100ms feels instantaneous, about 1s keeps flow, 16.7ms per frame sustains 60fps motion).

Qualities are grouped by domain in the catalog:

- **Common** (any interactive product): `responsiveness`, `smoothness`, `feedback`, `stability_feel`, `consistency`, `startup_readiness`, `progress_transparency`, `recoverability`, `continuity`, `effortlessness`, `accessibility`, `resource_frugality`
- **Web**: `freshness`, `seamless_navigation`, `cross_browser_consistency`, `shareability`
- **Game** (including networked play): `control_latency`, `frame_pacing`, `netplay_responsiveness`, `sync_integrity`, `disruption_tolerance`, `matchmaking_flow`, `load_seamlessness`, `audio_visual_sync`, `fairness_feel`, `progression_integrity`
- **`custom`**: caller-defined; no defaults, explicit targets required.

`ProjectContext.domain` selects which sections contribute default proposals: the common section always applies; the web and game sections apply when the domain matches. A caller may reference any quality explicitly regardless of domain — domain filtering only affects what Augur proposes on its own.

Rules:

- Explicit targets always win over defaults. "20ms" from the caller replaces the 100ms default entirely.
- Proposed defaults are **proposals**: the resulting suggestions are marked `proposedBudget: true` and carry mid-band confidence at most, because Augur guessed the number, not the caller.
- A `custom` quality without explicit targets yields investigation-first guidance asking the caller to quantify the goal, not a fabricated budget.

## Scope and Exemptions

A budget should not harden tests everywhere. "Respond within 20ms" is right for search-as-you-type and wrong for login, registration, checkout, or report generation — flows where users expect and tolerate longer waits.

Applicability rules:

1. A target with an explicit `scope` applies only to that scope.
2. A target without a `scope` applies to every area visible in the request's signals, **minus exempted scopes**.
3. An exemption either waives the budget for its scope entirely, or substitutes a `relaxedTarget` ("login: relaxed to ≤ 3s"). When a `relaxedTarget` is present, Augur emits a guardrail for the relaxed budget instead of dropping coverage.
4. Exempting a scope never deletes the caller's explicit target for that same scope. Explicit caller intent always wins; the conflict is surfaced as a `Risk` instead.

Exemptions come from two sources:

- **Caller-supplied** — part of the request, applied deterministically by the core engine.
- **LLM-proposed** — with LLM assistance enabled, Augur can judge semantically which areas a quality does not need to cover (recognizing that "login" is an authentication flow where instant response is not the expectation) and propose exemptions the caller did not write down. Proposed exemptions are always labeled `proposedBy: "llm"`, are reported as `budget_exemption` evidence, and downgrade — never silently remove — the affected guardrails: the suggestion survives with reduced priority and a rationale explaining the proposed exemption. With LLM assistance disabled, only caller-supplied exemptions exist and behavior is fully deterministic.

## Behavior

1. Augur reads `experienceGoals` from the request. Goals may accompany any objective kind, not only `performance`.
2. Each goal is resolved into one or more `ExperienceTarget`s: explicit targets pass through; missing targets are filled from the catalog defaults for the project's domain and flagged as proposed.
3. Exemptions are applied per the scope rules above, narrowing where each target generates strict guardrails and substituting relaxed budgets where defined.
4. Each resolved target becomes an `Evidence` entry of type `experience_goal`; each applied exemption becomes an `Evidence` entry of type `budget_exemption`.
5. Supplied `RuntimeSignal`s are compared against resolved targets where metric, unit, and scope match. A measurement exceeding its budget becomes an `Evidence` entry of type `budget_violation`. Signals inside an exempted scope are compared against the relaxed budget when one exists, and otherwise not flagged.
6. Each resolved target yields a guardrail `TestSuggestion` (kind `performance`) that carries the budget in its `budget` field, so the generated test knows exactly what to assert. The draft describes an externally executed measurement asserted against the threshold.
7. Priority and confidence follow the evidence:
   - Target violated by a supplied signal → `critical` or `high` priority, confidence ≥ 0.8 (direct evidence).
   - Explicit target, no measurement yet → `high` or `medium` priority, guardrail framed as "establish the measurement first".
   - Proposed default → at most `medium` priority, confidence ≤ 0.6, and the rationale must state the budget is a proposal.
8. The fix policy reacts to violations: `investigate_first` unless the caller supplied evidence locating the bottleneck, in which case a narrower strategy is allowed per the [Purpose-Driven Fix Policy](./purpose-driven-fix-policy.md).

## Worked Example

Input: objective `performance` ("the app should feel instant"), goal `responsiveness` with explicit target `api_latency p95 ≤ 20ms` (no scope, so it applies everywhere), a caller exemption `{ scope: "auth (login, registration)", reason: "users tolerate multi-second auth", relaxedTarget: ≤ 3s }`, and runtime signals reporting `/search` at p95 = 42ms and `/login` at p95 = 800ms.

Augur produces:

- Evidence: the goal (`experience_goal`), the auth exemption (`budget_exemption`), and the 42ms `/search` measurement exceeding 20ms (`budget_violation`). The 800ms `/login` measurement is **not** a violation — it sits inside the exempted scope and under the relaxed 3s budget.
- Test plan: a `performance` guardrail for `/search` carrying `{ metric: "api_latency", threshold: 20, unit: "ms", percentile: 95 }`, priority `critical`, confidence ≥ 0.8 — the budget is explicit and already violated. Plus a lower-priority guardrail for auth flows carrying the relaxed 3s budget, so the exempted area keeps coverage at its own bar.
- Fix policy: `investigate_first` with steps to profile `/search` before changing code, since no bottleneck evidence was supplied.

With LLM assistance enabled and no caller exemption, Augur could propose the auth exemption itself, labeled `proposedBy: "llm"`, and the `/login` guardrail would be downgraded with a rationale explaining the proposal instead of silently vanishing.

## Constraints

- Augur must not perform measurements; budgets are assertions for external runners such as CI performance jobs.
- Augur must not present a proposed default as if the caller chose it. Proposals — default budgets and LLM-proposed exemptions alike — are always labeled.
- An LLM-proposed exemption must never override a caller's explicit target or delete a guardrail outright; it can only downgrade priority and attach its reasoning.
- Budget comparison requires matching units; Augur must not silently convert or guess units that do not match.
- With LLM assistance disabled, resolution is deterministic: the same goals, exemptions, and signals always resolve to the same targets, per the [Planning Engine](./planning-engine.md).

## Related Specs

- [Core Data Schema](../data/core-schema.md)
- [Experience Goal Catalog](../data/experience-goal-catalog.md)
- [Planning Engine](./planning-engine.md)
- [Purpose-Driven Test Plan](./purpose-driven-test-plan.md)
- [Purpose-Driven Fix Policy](./purpose-driven-fix-policy.md)
- [Service Test Strategy](../test/service-test-strategy.md)
