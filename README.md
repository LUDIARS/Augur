# Augur

Augur is a purpose-driven test planning and fix policy service.

It does not execute tests. CI, local commands such as `npm run test`, and external test runners are responsible for execution. Augur reads objectives, code changes, failures, coverage, and runtime signals, then proposes what should be tested next and how the fix should be approached.

The flagship use case is experience-driven constraints: a caller states how the product should feel — "search should feel instant", or concretely "respond within 20ms" — and Augur resolves that feel into measurable budgets, decides where the budget applies and where it should be relaxed (login and registration need not finish in 20ms), and derives guardrail test cases that external runners enforce. See [spec/feature/experience-driven-constraints.md](./spec/feature/experience-driven-constraints.md).

Specifications are managed under [spec/](./spec/) using the AIFormat category folders:

- `data/`
- `feature/`
- `interface/`
- `setup/`
- `test/`

The implementation order and acceptance bar for each phase are defined in [spec/roadmap.md](./spec/roadmap.md). Technology choices, module layout, and internal interfaces are defined in [spec/implementation-design.md](./spec/implementation-design.md).
