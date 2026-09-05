# Inject CLI

## Purpose

The operational entry point for the [Log Injection Framework](../feature/log-injection.md). It is a repo-local script (not part of the built service): it reads target project sources, computes injection points, and writes marker-tagged fragments. The scanner/applier core in `src/inject/` stays pure — only this CLI touches the filesystem.

## Command

```text
node --experimental-strip-types scripts/inject-logs.ts <command> [options]
```

From Phase 3 the same tool is reached as `augur inject <command> [options]`
through the single entry point in [CLI](./cli.md); the commands, options, and exit
codes below are unchanged by that move.

| Command | Behavior |
| --- | --- |
| `scan` | list injection point candidates (rule, file, anchor, current state) |
| `apply` | insert fragments for all `pending` points; idempotent — already-marked anchors are skipped |
| `check` | report `applied` / `pending` / `orphaned` / `unresolved` / `stale-module` per point; `--strict` exits 1 when anything is not `applied` |
| `remove` | strip all marker-tagged fragments (wraps are unwrapped, inserted lines and imports deleted) |

## Options

| Option | Applies to | Behavior |
| --- | --- | --- |
| `--project <dir>` | all | target a single project root containing `augur.inject.json` |
| `--fleet <file.json>` | all | iterate a fleet file: `{ "projects": ["../Concordia", "../Lictor"] }`; each entry is resolved relative to the fleet file |
| `--json` | all | machine-readable output (one JSON document on stdout) |
| `--dry-run` | `apply`, `remove` | compute and print edits without writing |
| `--strict` | `check` | non-zero exit on `pending`, `orphaned`, `unresolved`, or `stale-module` |
| `--rule <name>` | all | restrict to one rule (repeatable) |
| `--diff-base <ref>` | `contract-wrap` | run Anatomia `pr-review --base <ref>` and inject only the contracts whose `file:symbol` the change added |
| `--analysis <file>` | `contract-wrap` | take that `PrDiffReview` JSON instead of running Anatomia (the gate already produced one) |
| `--include-existing` | `contract-wrap` | inject every contract the file names, added or not |

Exactly one of `--project` / `--fleet` is required; `--diff-base` and `--analysis` cannot be combined.

With none of the three contract options, every contract the file names is a target — which is what a repository that has not adopted Anatomia gets. The Anatomia CLI is located the same way `augur tests plan` locates it (`AUGUR_ANATOMIA_DIR`, defaulting to a sibling `../Anatomia` checkout) and is spawned without a shell.

## Output

Human output is one line per point:

```text
pending  silent-catch   src/db/repo.ts:141  catch in flushQueue
applied  spawn-watch    src/control/spawn.ts:88  child ← spawn(...)
orphaned interval-guard a1b2c3d4 (marker present, anchor gone)
```

`--json` emits `{ project, points: InjectionPoint[], summary: { applied, pending, orphaned, unresolved, staleModule } }` per project, wrapped in an array under `--fleet`.

`unresolved` and `stale-module` are `contract-wrap`'s: the contract file names a function the source no longer declares, or a predicate module that is missing or malformed (see [Log Injection Framework](../feature/log-injection.md), "Markers").

Contract manifest paths must remain inside the project; absolute paths, traversal, control characters, and symlinks that resolve outside the project are rejected before any source is changed. Generated string literals are escaped. `contract-wrap` imports `contract` from `augur.contracts.json#importFrom`; other rules use `augur.inject.json#importFrom`.

## `augur contracts lint`

```text
augur contracts lint [--project <dir>] [--json]
```

Checks `augur.contracts.json` on its own, without touching any source: duplicate ids (rejected by the schema), every `file:symbol` resolving to a top-level declaration, and every predicate module existing with an object-literal default export. Exit 0 when clean, 1 when the manifest is unreadable or any finding is reported. `--json` emits `{ project, contracts, findings: [{ contractId, code, file, symbol, message }] }`.

## `augur contracts report`

```text
augur contracts report [--project <dir>] [--logs <dir>] (--since <iso> | --all)
                       [--acceptance] [--json | --markdown]
```

Aggregates the weaver JSONL the contract wrappers wrote into one row per contract:
`covered` (at least one `contract observed`, no violation), `violated` (at least one
`contract violated` or `contract predicate threw`, with per-phase counts and the
newest three reasons), or `uncovered` (neither, shown as `not-injected` when the
source carries no marker and `not-called` when it does).

Only events whose `ctx.id` matches the marker `check` resolves from the *current*
source are counted, so another repository's same-named contract — or a marker a
later edit replaced — is never read as evidence. `--logs` defaults to the runtime's
own resolution: `VESTIGIUM_LOGS_DIR`, then `<project>/logs`; every `*.jsonl` in that
directory is read in filename order.

Exactly one of `--since <iso>` / `--all` is required: without a lower bound a
violation from a previous delegation would decide this one. Events with no readable
timestamp are counted in `diagnostics.undated` and reported as a warning on stderr,
but a bounded window excludes them from the aggregation.

`--acceptance` emits Concordia's `acceptance_report` shape,
`[{ criterion, met, note }]`, with `criterion` reproduced byte-for-byte from the
manifest and `met` true only for `covered`. It cannot be combined with `--all` or
`--markdown`, and it is a usage error (exit 1) when any contract sets `sample < 1`,
because sampling makes `uncovered` indistinguishable from "never called".

`--json` emits `{ project, logs, window, totals, diagnostics, contracts }`. The same
JSONL and manifest always produce a byte-identical document. Human output is one
line per contract (state, id, symbol, calls, violations, latest reason) followed by a
`summary:` line.

## Exit Codes

| Code | Meaning |
| --- | --- |
| 0 | command completed (for `check` without `--strict`: always, drift included) |
| 1 | `check --strict` found drift, or a project/manifest could not be read |
| 2 | bad invocation (unknown command, missing `--project`/`--fleet`) |
