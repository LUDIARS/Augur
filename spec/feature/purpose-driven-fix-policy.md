# Purpose-Driven Fix Policy

## Purpose

Augur creates a repair strategy that matches the caller's objective and available evidence.

The fix policy is not a patch. It is a structured implementation direction that explains how a developer or AI coding agent should approach the change.

## User Story

As a developer or AI coding agent,
I want a fix policy paired with the test plan,
so that I can choose a safe implementation direction before editing code.

## Inputs

- Objective kind and description
- Experience goals, resolved budgets, and budget violations
- Failure logs and stack traces
- Code diff or changed files
- Runtime and coverage signals
- Project constraints

## Behavior

1. Augur identifies the safest repair strategy for the objective.
2. Augur lists ordered fix steps.
3. Augur identifies target files when possible.
4. Augur calls out risks and rollback guidance.
5. Augur links fix steps to supporting evidence.

## Strategy Mapping

- `new_feature`: prefer `test_first` when behavior is clear.
- `bug_fix`: prefer `test_first` when a reproduction path exists.
- `regression`: prefer `minimal` or `test_first` depending on blast radius.
- `refactor`: prefer `behavior_preserving`.
- `performance`: prefer `investigate_first` unless a clear bottleneck is supplied.
- `stability`: prefer `investigate_first` until a deterministic reproduction exists, then `minimal`.
- `security`: prefer `contract_first` and explicit validation boundaries.
- `unknown`: prefer `investigate_first`.

## Output

The feature returns a `FixPolicy`.

The policy must include:

- selected strategy
- ordered steps, each referencing supporting evidence
- risks
- rollback guidance when useful

## Constraints

- Augur must not directly mutate application code.
- Augur must not recommend broad rewrites when a narrow fix is supported by evidence.
- Augur should prefer reversible steps when evidence is weak.

## Related Specs

- [Core Data Schema](../data/core-schema.md)
- [Experience-Driven Constraints](./experience-driven-constraints.md)
- [Planning Engine](./planning-engine.md)
- [HTTP API](../interface/http-api.md)
- [Service Test Strategy](../test/service-test-strategy.md)

