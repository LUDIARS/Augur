# Augur

Augur is a purpose-driven test planning and fix policy tool.

It ships as a **command-line tool with no resident process**: there is no Augur
daemon and no port. A stateless planner does not need a server to be available,
it needs to be callable — see [Daemon-less CLI](./spec/plan/daemonless-cli.md)
for the decision and the migration. `bin/augur.mjs` is the entry point other
tools invoke; the HTTP server that still exists on `main` is removed in roadmap
Phase 6, once Anatomia's Test Suggestions bridge — its only caller — has moved to
`augur plan --request -`.

The first CLI caller is Revisor, which asks Augur which checks a specific code change
deserves at the start of every local pull-request review:
[Review Plan CLI](./spec/interface/review-plan-cli.md). A documentation edit stops
paying for a vulnerability pass and a full test suite; a change touching
executable code keeps everything, and the caller enforces a safety floor Augur
cannot talk it out of.

It does not execute tests. CI, local commands such as `npm run test`, and external test runners are responsible for execution. Augur reads objectives, code changes, failures, coverage, and runtime signals, then proposes what should be tested next and how the fix should be approached.

The flagship use case is experience-driven constraints: a caller states how the product should feel — "search should feel instant", or concretely "respond within 20ms" — and Augur resolves that feel into measurable budgets, decides where the budget applies and where it should be relaxed (login and registration need not finish in 20ms), and derives guardrail test cases that external runners enforce. See [spec/feature/experience-driven-constraints.md](./spec/feature/experience-driven-constraints.md).

For games, the same machinery plans screenshot- and video-based tests: an external capture harness records scripted play, frame analyzers reduce the footage to numbers (golden-image diffs, render artifacts, frames flagged against a content rating tier such as CERO for violence or blood expression), and Augur turns those numbers into budgets, violations, and guardrail test suggestions. See [spec/feature/media-based-testing.md](./spec/feature/media-based-testing.md).

Augur also manages fleet-wide **log injection**: a repo-local tool (`npm run inject`) that scans LUDIARS projects for known stability seams (bare catches, unwatched spawns, unguarded async intervals/listeners) and injects marker-tagged observation calls that emit through `@ludiars/log-weaver` to Vestigium JSONL — turning operation-time logs into the runtime signals that drive automatic repair of small stop bugs. See [spec/feature/log-injection.md](./spec/feature/log-injection.md) and [spec/interface/inject-cli.md](./spec/interface/inject-cli.md); the per-project onboarding guide is [spec/setup/adopting-log-injection.md](./spec/setup/adopting-log-injection.md).

Specifications are managed under [spec/](./spec/) using the AIFormat category folders:

- `data/`
- `feature/`
- `interface/`
- `setup/`
- `test/`

The implementation order and acceptance bar for each phase are defined in [spec/roadmap.md](./spec/roadmap.md). Technology choices, module layout, and internal interfaces are defined in [spec/implementation-design.md](./spec/implementation-design.md). The implementation handoff for the external media capture/analysis tool is [spec/media-tool-implementation.md](./spec/media-tool-implementation.md).
