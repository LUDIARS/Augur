# Log Injection Framework

## Purpose

Augur plans tests from runtime signals, but most LUDIARS services fail in ways that never reach a test: small stop-the-world bugs — an unhandled rejection, a spawn without an error listener, an async interval body that throws once and silently dies. Concordia's stability analysis (Concordia `spec/plan/problems/stability-checklist.md`) showed these failure modes are generic and mechanically detectable.

This feature makes Augur the fleet-wide manager of **log injection**: it scans a target project for the stability checklist's known-dangerous seams, and injects observation/guard calls there — the same way Concordia injects measurement externally (HTTP middleware, console capture, hooks) instead of hand-editing call sites. The injected logs flow to Vestigium (Vg) JSONL, where the existing observability pipeline (file tail → error detection → error task → auto-fix) can act on them. Injection is how operation-time logs become the signal that drives automatic repair of stability bugs.

Augur does not run in the target's process. It is a script-level manager: **scan → apply → check → remove**, batch-applied across a fleet of local project checkouts.

## Two Layers

| Layer | Lives in | Injected how | Covers |
| --- | --- | --- | --- |
| **Runtime weaver** (`@ludiars/log-weaver`, Lapilli) | target's `node_modules` | one `import '@ludiars/log-weaver/auto'` line at the entrypoint | process safety net (unhandledRejection / uncaughtException), event-loop lag, sink binding to Vg |
| **Source injection** (this spec) | target's source files | marker-tagged statements/wraps inserted by the Augur script | seams that need a code position: bare catches, unwatched spawns, unguarded async intervals/listeners |

The runtime layer is pure AOP: nothing in the target's code changes except one import. The source layer is used only where a probe must sit at a specific position; every insertion is tagged so it stays machine-owned (idempotent, checkable, removable).

## Detection Rules

The scanner parses each included file with the TypeScript compiler API (TS and ESM JS both parse). Each rule yields `InjectionPoint`s with a deterministic id.

| Rule | Anchor | Injected text | Checklist item |
| --- | --- | --- | --- |
| `entry-runtime` | entrypoint file (declared in the manifest) with neither the weaver auto-import nor its own `process.on('unhandledRejection')` | `import '@ludiars/log-weaver/auto';` at the top of the file | §1 process safety net |
| `silent-catch` | `catch` clause whose block is empty **and contains no comment** (a comment means the developer already decided) | `weaverLog('warn', 'swallowed error', …)` as the block's only statement | §8 crashes must leave a trace |
| `spawn-watch` | `spawn`/`execFile` result assigned to a variable that is never given an `.on('error', …)` in the same scope | `watchChild(<var>, { where })` statement after the assignment | §2 spawn error listeners |
| `interval-guard` | `setInterval(<async function literal>, …)` whose body is not fully wrapped in try/catch | wrap the callback: `guardAsync(<fn>, { where })` | §1 timer body guards |
| `listener-guard` | `.on(<string>, <async function literal>)` / `.once(…)` whose body is not fully wrapped in try/catch | wrap the callback: `guardAsync(<fn>, { where })` | §1 async listener guards |
| `contract-wrap` | a `file:symbol` **named by `augur.contracts.json`** — not discovered by the scanner | wrap the function: `contract(<fn>, { ...<predicate>, contractId, mode, sample, where, rule, id })` | acceptance criteria as contracts ([live contract testing](../plan/2026-09-05-live-contract-testing.md) §2.3) |

`contract-wrap` differs from the other four in where its anchors come from: the contract file names them, and the scanner only resolves the name to a position. Three declaration forms are supported, all by insertion alone:

| Declaration | Injected |
| --- | --- |
| `export const f = <initializer>` | the initializer is wrapped in `contract(…)` |
| `export function f(…) {}` | the declaration is left as it is; a `f = contract(f, …);` line is added after it, preceded by `// @ts-expect-error augur-inject` (TS2630 forbids assigning to a function declaration) |
| `class C { m(…) {} }` | `C.prototype.m = contract(C.prototype.m, …);` after the class — `C.m = …` for a `static` method |

Private methods (`#m`) and symbols the file does not declare at the top level are `unresolved`; they are reported, never guessed at. The `contract` import comes from `augur.contracts.json`'s `importFrom`; the other injection rules continue to use `augur.inject.json`'s `importFrom`, so projects may intentionally route contract observation through a distinct runtime module. Each contract's predicate module is imported by default on its own marker-tagged line.

Insertion never alters control flow beyond what the checklist itself prescribes: `weaverLog` only records; `guardAsync` catches, records, and swallows — which is exactly the stabilization the checklist asks for (a throwing interval/listener body must not kill the process or the timer). `watchChild` attaches an `error` listener, turning a fatal missing-listener crash into a logged event.

## Markers

Every injected fragment carries a marker comment:

```
/* augur-inject:<rule>:<id> */
```

- `id` is an 8-hex-char hash of `(rule, relative file path, anchor path, ordinal)`, so re-scans of unchanged code produce identical ids (deterministic, like the planning engine).
- **Markers are the only state.** There is no lockfile: `apply` skips anchors already carrying a marker, `remove` strips fragments by marker, and `check` diffs the marker set found in source against a fresh scan.
- Inserted imports (`weaverLog`, `guardAsync`, `watchChild`) are themselves marker-tagged lines, added once per file and removed when the last marker in the file goes.

`check` classifies each point:

| State | Meaning |
| --- | --- |
| `applied` | scan candidate has a matching marker |
| `pending` | scan found a candidate with no marker (new code appeared) |
| `orphaned` | marker exists but no scan candidate matches it (anchor was refactored away — the fragment may now be dead or misplaced) |
| `unresolved` | `contract-wrap` only: `augur.contracts.json` names a `file:symbol` the source no longer declares |
| `stale-module` | `contract-wrap` only: the contract's predicate module is missing, or does not `export default` an object literal |

`check --strict` exits non-zero when anything is `pending`, `orphaned`, `unresolved` or `stale-module`, so a target repo can put it in CI.

## Manifest

Each managed project declares intent in `augur.inject.json` at its root:

```json
{
  "service": "concordia",
  "include": ["src/**/*.ts", "tools/**/*.mjs"],
  "exclude": ["**/*.test.ts", "**/*.test.mjs", "dist/**"],
  "runtime": { "autoImport": true, "entrypoints": ["src/server.ts"] },
  "rules": {
    "silent-catch": true,
    "spawn-watch": true,
    "interval-guard": true,
    "listener-guard": true
  },
  "importFrom": "@ludiars/log-weaver"
}
```

- `rules` toggles detection per rule; omitted rules default to on.
- `importFrom` lets a project alias the runtime (e.g. a local shim that binds to an already-installed Vg writer) without changing injected call shapes.
- `runtime.autoImport: false` opts out of `entry-runtime` for projects that already install their own safety net (Concordia after its stability fixes does).

`contract-wrap` reads a second file, `augur.contracts.json`, placed beside the manifest. It names the contracts, their predicate modules, and the acceptance criterion each one stands for; its schema and the `augur contracts lint` check live in [live contract testing](../plan/2026-09-05-live-contract-testing.md) §3 / §6. A project without that file simply has no `contract-wrap` points.

Fleet management is a JSON list of project directories (see [Inject CLI](../interface/inject-cli.md)); every command accepts `--fleet` and iterates, so one Augur checkout can scan/apply/check all sibling LUDIARS checkouts in one run.

## Sink Contract

Injected calls emit `WeaverEvent`s — `{ level, msg, ctx }`, the same shape Vg's writer accepts. Binding order in `@ludiars/log-weaver/auto`:

1. `@ludiars/vestigium` is importable → `install()` and bind its writer.
2. Otherwise append JSONL to `${VESTIGIUM_LOGS_DIR || <cwd>/logs}/weaver.jsonl` — the same directory Concordia's observability tail reads, so events reach the pipeline even without the Vg dependency.
3. `NODE_ENV=test`, `VITEST`, or `LOG_WEAVER=0` → no-op sink.

The Vg context rule is inherited: **no tokens, PII, or raw command/prompt data in `ctx`** — injected fragments only ever record rule id, file, anchor name, and error message/stack.

## Design Review Notes (decisions and rejected alternatives)

- **Markers-in-source over a lockfile.** A lockfile desynchronizes the moment someone edits code without the tool; markers travel with the code through merges and refactors, and `check` can always recompute truth from source alone.
- **Text splicing at AST positions over AST re-printing.** Re-printing reformats whole files and produces unreviewable diffs. Splicing touches only the inserted fragment; the surrounding file stays byte-identical.
- **Skip commented catches.** Flagging every `catch { /* reason */ }` would bury real findings in intentional ones; a comment is treated as an explicit human decision (Concordia's `never throw from logging` catches stay untouched).
- **Runtime probes via one import, not codemod.** Everything that doesn't need a source position (safety net, lag) stays out of the diff entirely — smallest possible footprint in the target, and upgrading the weaver package upgrades all targets without re-injection.
- **No CJS support in v1.** All LUDIARS targets are ESM; `require`-based injection doubles the splicing matrix for no current consumer.
- **Scanner is pure.** Detection and edit computation take `(path, sourceText)` and return data; only the CLI touches the filesystem — same engine/IO boundary as the planning engine, and what makes the rules unit-testable on string fixtures.

## Relationship to Planning

Injected logs are runtime signals. Once a fleet member ships weaver events to Vg, those JSONL lines can be fed back to `augur plan` (`--signals`) or the HTTP API as evidence — closing the loop this feature exists for: observe in operation, detect the small stop bugs, and hand the AI a reproducible signal to fix them against.
