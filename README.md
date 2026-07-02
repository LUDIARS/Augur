# Augur

Augur is a purpose-driven test planning and fix policy service.

It does not execute tests. CI, local commands such as `npm run test`, and external test runners are responsible for execution. Augur reads objectives, code changes, failures, coverage, and runtime signals, then proposes what should be tested next and how the fix should be approached.

Specifications are managed under [spec/](./spec/) using the AIFormat category folders:

- `data/`
- `feature/`
- `interface/`
- `setup/`
- `test/`

The implementation order and acceptance bar for each phase are defined in [spec/roadmap.md](./spec/roadmap.md).
