# Inject CLI

## Purpose

The operational entry point for the [Log Injection Framework](../feature/log-injection.md). It is a repo-local script (not part of the built service): it reads target project sources, computes injection points, and writes marker-tagged fragments. The scanner/applier core in `src/inject/` stays pure — only this CLI touches the filesystem.

## Command

```text
node --experimental-strip-types scripts/inject-logs.ts <command> [options]
```

| Command | Behavior |
| --- | --- |
| `scan` | list injection point candidates (rule, file, anchor, current state) |
| `apply` | insert fragments for all `pending` points; idempotent — already-marked anchors are skipped |
| `check` | report `applied` / `pending` / `orphaned` per point; `--strict` exits 1 when anything is not `applied` |
| `remove` | strip all marker-tagged fragments (wraps are unwrapped, inserted lines and imports deleted) |

## Options

| Option | Applies to | Behavior |
| --- | --- | --- |
| `--project <dir>` | all | target a single project root containing `augur.inject.json` |
| `--fleet <file.json>` | all | iterate a fleet file: `{ "projects": ["../Concordia", "../Lictor"] }`; each entry is resolved relative to the fleet file |
| `--json` | all | machine-readable output (one JSON document on stdout) |
| `--dry-run` | `apply`, `remove` | compute and print edits without writing |
| `--strict` | `check` | non-zero exit on `pending` or `orphaned` |
| `--rule <name>` | all | restrict to one rule (repeatable) |

Exactly one of `--project` / `--fleet` is required.

## Output

Human output is one line per point:

```text
pending  silent-catch   src/db/repo.ts:141  catch in flushQueue
applied  spawn-watch    src/control/spawn.ts:88  child ← spawn(...)
orphaned interval-guard a1b2c3d4 (marker present, anchor gone)
```

`--json` emits `{ project, points: InjectionPoint[], summary: { applied, pending, orphaned } }` per project, wrapped in an array under `--fleet`.

## Exit Codes

| Code | Meaning |
| --- | --- |
| 0 | command completed (for `check` without `--strict`: always, drift included) |
| 1 | `check --strict` found drift, or a project/manifest could not be read |
| 2 | bad invocation (unknown command, missing `--project`/`--fleet`) |
