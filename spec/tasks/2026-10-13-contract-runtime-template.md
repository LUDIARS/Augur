# Contract runtime template and daily log rotation (SPEC-CONTRACT-RUNTIME-TEMPLATE)

Specification ID: SPEC-CONTRACT-RUNTIME-TEMPLATE

Actio: ec8354d1-dbc7-4857-aef5-8198f16cec57. Human start: neco, 2026-10-13 — 「ログはログとして参照せずにデイリーでローテーションして、アクティブな契約だけを見る」「Augur の雛形に一本化してから」各リポへ入れる。

## Problem

Each repository carried its own hand-written `contract()` runtime (Actio `src/contract-runtime.ts`, Revisor `src/contract-runtime.mjs`, Infra `scripts/garnet/contract-runtime.mjs`). They had drifted (Revisor's default directory is `.contracts-logs`, and a throwing predicate there propagated into the wrapped call), and every copy appended to one `contracts.jsonl` forever. Excubitor injects one shared `VESTIGIUM_LOGS_DIR` into every service, so long-running services (actio-web) and Revisor all grow the same file.

## Template (single source)

`templates/contract-runtime/contract-runtime.ts` and `contract-runtime.mjs` hold the same rules; `test/contracts/runtime-rotation.test.ts` runs one suite against both.

- Observation never changes the wrapped operation: results, sync exceptions and promise rejections pass through; predicate exceptions are recorded, never rethrown; every filesystem failure is swallowed.
- Arguments and results are never recorded.
- Destination: `VESTIGIUM_LOGS_DIR`, else `<cwd>/logs`, file `contracts.jsonl` — the same resolution `augur contracts report` uses.

## Daily rotation

- Day boundary: JST (UTC+9, no DST). Operators and hosts read logs on the Japanese calendar; a UTC boundary would cut their day at 09:00.
- Trigger: the first write of a process on a new day `stat`s the active file once; if its mtime falls on an earlier JST day it is archived. Later writes that day skip the check (one `stat` per process per day).
- Archive: `logs/archive/contracts-YYYY-MM-DD.jsonl`, named after the day of the file's last write.
- Multi-process safety: `rename(active → archive/.contracts-<day>.<pid>.<ms>.part)` is the claim — exactly one process wins, the others see `ENOENT` and carry on. The winner publishes with `link(part → contracts-<day>.jsonl)`, which fails with `EEXIST` instead of overwriting; then the part is appended to the existing archive. No line is dropped. A Windows sharing violation leaves the file in place and the check is retried on the next write.
- Retention: archives (and orphaned `.part` claims) whose day is older than `today − N` days are deleted after a rotation. `N` = `AUGUR_CONTRACT_LOG_RETENTION_DAYS` (non-negative integer), default 7.
- Known window: an append racing the rename may land in the archived file; it is then out of the report, like every archived event.

## Reading side

`readWeaverLogLines` reads only `*.jsonl` directly under the logs directory, so `archive/` is never evidence. Aggregation already keeps only contracts in the ledger whose events carry the marker id the current source resolves (`foreign` otherwise). Tests: `log-lines.test.ts` (archive/part files ignored), `report-cli.test.ts` (archived violation and off-ledger contract do not count).

## Distribution

`augur.contracts.json#runtimeFile` (optional, repository-relative) names the generated copy that `importFrom` resolves to.

- `augur contracts runtime sync [--path <file>]` writes the template (`.ts`/`.mts` → typed, `.mjs`/`.js` → plain) with a header `// augur-contract-runtime version=<n> sha256=<body hash>`. Up-to-date copies are not rewritten.
- `augur contracts runtime check` exits 1 for `missing`, `unmanaged` (no header), `modified` (body hash ≠ header) or `outdated` (older template). Line endings are normalized before hashing.

An npm package was not chosen: the copy must stay a zero-dependency in-tree file so each repository builds without a registry, and `file:` dependencies break in worktrees (Revisor review worktrees, Cc delegation worktrees).

## Revisor review impact

Revisor's review runs `augur tests run --for-revisor` in the review worktree with its own env, so contract events from those tests go to the shared `VESTIGIUM_LOGS_DIR`, and the run's `contracts` section aggregates `[startedAt, finishedAt]`. The section is a reading aid: Revisor's pass/fail uses the run record's test status, not contract states. A review straddling JST midnight can lose the events written before the rotation from that section; it cannot fail the review. Delegation acceptance (`--since $DELEGATION_STARTED_AT`) likewise only sees the current day; a delegation crossing midnight re-runs its checks after midnight.

## Rollout

Augur merge first (CLI reflection needs `npm run build` in the Augur checkout because `bin/augur.mjs` prefers `dist/`). Then Actio and Revisor each set `runtimeFile` and replace their copy with `augur contracts runtime sync` output (one PR each). Infra is out of scope until its PR #2743 lands.
