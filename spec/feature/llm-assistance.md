# LLM Assistance

## Purpose

This spec completes the Phase 4 design sketched in the [Planning Engine](./planning-engine.md): the concrete provider abstraction, the two role contracts, failure handling, and the guarantees that keep the deterministic core intact.

LLM assistance is **off by default**. With it off, Augur's behavior is byte-for-byte what Phases 0–2 ship. With it on, exactly two things change: prose reads better, and Augur can notice on its own that "login doesn't need to be 20ms".

## Configuration

| Variable | Meaning |
| --- | --- |
| `AUGUR_LLM_PROVIDER` | provider id, e.g. `anthropic`; unset disables assistance entirely |
| `AUGUR_LLM_API_KEY` | credential for the provider; unset disables assistance |
| `AUGUR_LLM_MODEL` | optional model override; each provider defines a default |
| `AUGUR_LLM_TIMEOUT_MS` | per-call timeout; default `10000` |

Both `PROVIDER` and `API_KEY` must be present to enable assistance. There is no per-request opt-in in Phase 4; assistance is a deployment decision.

## Provider Abstraction

```ts
interface LlmProvider {
  complete(prompt: string, options: { json?: boolean }): Promise<string>;
}
```

One implementation per provider under `src/llm/providers/`. Phase 4 ships a single provider; the interface — not the vendor — is the commitment. Providers own their own HTTP details; nothing outside `src/llm/` may import a provider SDK.

## Role 1: Prose Enrichment

```ts
function enrichProse(plan: PlanResponse, provider: LlmProvider): Promise<PlanResponse>;
```

Runs after `createPlan` returns. The prompt contains the full plan and instructs the model to rewrite **only** these fields, returning the complete plan JSON:

- `summary`
- each suggestion's `rationale`, `draft.description`, `draft.outline`
- each fix step's `description`

### The structural guard is code, not convention

After the model responds, `enrichProse`:

1. Parses the response against `planResponseSchema`; parse failure discards the enrichment.
2. Masks the prose fields on both plans and deep-compares the remainder. **Any** structural difference — ids, kinds, priorities, confidences, budgets, evidence, ordering, added or removed elements — discards the enrichment and returns the original plan.

Discarding is silent success, not an error: the deterministic plan was already correct.

## Role 2: Exemption Proposal

```ts
function proposeExemptions(request: CreatePlanRequest, provider: LlmProvider): Promise<ExperienceExemption[]>;
```

Runs before `createPlan`, only when the request has `experienceGoals`. The prompt contains the objective, the goals with their targets, the scopes visible in the request's signals, and the "typical exemptions" lists from the matching [catalog](../data/experience-goal-catalog.md) entries. It asks one question: *which of these scopes does this quality not need to cover strictly, and why?*

The model returns a JSON array validated against `experienceExemptionSchema`, then filtered:

- entries failing validation are dropped;
- at most **5** proposals survive (ranked as returned);
- every survivor is stamped `proposedBy: "llm"` by `proposeExemptions` itself — the model's own labeling is ignored;
- proposals whose scope matches a caller-supplied exemption are dropped as redundant.

Survivors are passed to the engine as `PlanOptions.proposedExemptions`. Everything after that point is the deterministic pipeline already implemented and tested: proposals only downgrade guardrails, never delete them, never override caller-explicit targets, and always surface as `budget_exemption` evidence (ST-012).

## Request Flow

```text
HTTP handler / CLI
  ├─ assistance off:  createPlan(request)
  └─ assistance on:   proposeExemptions(request)   — may return []
                      createPlan(request, { proposedExemptions })
                      enrichProse(plan)             — may return plan unchanged
```

Failure handling at each step is the same: **timeout, provider error, or malformed output degrades to the deterministic behavior** — empty proposals, unenriched plan. An LLM outage can never make `POST /v1/plans` fail; it can only make it plainer.

## Privacy

Enabling assistance sends request content — objectives, diffs, failure logs, scope names — to the configured provider. Deployments must not enable it for data they cannot share with that provider. Augur adds no telemetry and stores nothing in Phase 4 (storage is [Phase 5](../data/persistence.md)).

## Testing

- Golden and safety suites always run with assistance disabled and must pass unchanged (roadmap Phase 4 acceptance).
- A mock `LlmProvider` drives the Phase 4 suites: well-formed proposals, malformed JSON, structural tampering in enrichment, timeouts. The tampering case must show the guard discarding the enrichment.
- ST-012 covers the engine-side subordination rules and already passes against `PlanOptions.proposedExemptions`.

## Non-Goals

The LLM never: generates test code, selects the fix strategy, scores confidence, adds or removes suggestions, invents budgets, or sees provider credentials outside `src/llm/`.

## Related Specs

- [Planning Engine](./planning-engine.md) — the two-role boundary this spec details
- [Experience-Driven Constraints](./experience-driven-constraints.md) — exemption semantics
- [Implementation Design](../implementation-design.md) — module layout and the `PlanOptions` seam
- [Roadmap](../roadmap.md) — Phase 4
