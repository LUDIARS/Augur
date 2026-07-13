# Focused Testing

## Purpose

Focused testing turns caller-defined domain and variable importance into a deterministic,
evidence-backed test plan. It is intended for codebases where a player action, authoritative
state, or security boundary requires denser testing than lower-impact behavior in the same
project.

Augur consumes analysis facts; it does not inspect source code and does not call an LLM.
Anatomia is the first producer of these facts.

## Request Contract

`CreatePlanRequest.focusedTesting` contains:

```ts
{
  source: "anatomia";
  domains: Array<{
    domain: string;
    priority: "critical" | "high" | "medium" | "low";
    risks: Array<
      "boundary" | "memory_safety" | "authorization" |
      "state_transition" | "concurrency" | "contract"
    >;
    inferredRisks?: Array<
      "boundary" | "memory_safety" | "authorization" |
      "state_transition" | "concurrency" | "contract"
    >;
    rationale?: string;
    targets: Array<{
      symbol: string;
      file: string;
      line: number; // zero-based, matching Anatomia SourcePosition
      variables: Array<{
        name: string;
        kind: "parameter" | "field";
        priority: "critical" | "high" | "medium" | "low";
        type?: string;
      }>;
    }>;
  }>;
}
```

The HTTP boundary rejects duplicate domains, empty target sets, invalid priorities and risk
kinds. Paths and symbols are facts supplied by the analyzer; Augur never reads them from disk.

## Deterministic Suggestions

`src/engine/focusedTesting.ts` emits one candidate per `(domain, risk)` pair.

| risk | suggestion kind | focus |
|---|---|---|
| `boundary` | `unit` | lower/upper/empty/invalid values |
| `memory_safety` | `security` | ownership, lifetime, bounds, use-after-release |
| `authorization` | `security` | trust boundary and authority checks |
| `state_transition` | `regression` | valid/invalid transitions and invariants |
| `concurrency` | `flaky` | ordering, repeated execution, race exposure |
| `contract` | `contract` | public pre/postconditions and compatibility |

The candidate priority is the highest impact band among the domain and its matched variables.
Target files and variable names are copied into the draft. Confidence is derived only from the
presence of analyzer targets and matched variables. Every candidate references a
`focused_test_focus` evidence item.
When `inferredRisks` is present, evidence and rationale label those risks as mechanically inferred
by Anatomia rather than caller-selected.

Focused candidates are combined with the ordinary objective rule candidates before stable
priority/confidence ranking. Existing suggestions are not deleted.

## Guarantees

- Same request produces byte-identical output.
- No LLM, filesystem, command, or test-runner access occurs in the engine.
- Caller priority is never silently lowered.
- Analyzer facts are evidence, not inferred claims about test results.
