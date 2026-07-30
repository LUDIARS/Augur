# Daemon-less CLI

Decision and migration plan for turning Augur from a loopback HTTP service into
a command-line tool with no resident process (neco 2026-07-30).

## Decision

**Augur ships as a CLI. There is no Augur daemon.**

The planning engine stays exactly as it is. What goes away is the process that
wraps it: `src/server.ts`, `src/app.ts`, `src/routes/`, the `AUGUR_PORT`
listener, and the Excubitor catalog registration on port 4210. What replaces it
is `bin/augur.mjs` with subcommands, one of which — `review-plan` — is the
contract Revisor calls to have its review planned
([Review Plan CLI](../interface/review-plan-cli.md)).

## Why

- **Augur is already a pure function.** [Implementation
  Design](../implementation-design.md) states the server holds no state between
  requests, and the [Planning Engine](../feature/planning-engine.md) never
  executes anything and never reads source. A stateless computation does not
  need a resident process to be available; it needs to be callable.
- **It is not resident today.** The Excubitor entry carries `autostart: false`,
  so every HTTP caller would have to start Augur first. A CLI removes that step
  instead of documenting it.
- **The intended caller cannot rely on a listener.** Revisor plans a review
  inside a disposable worktree in a worker process, with no network use. It
  already drives Anatomia the same way, through `bin/anatomia.mjs`. Matching that
  precedent means one integration shape, not two.
- **The CLI was always the richer surface.** [CLI](../interface/cli.md) gathers
  git state, coverage, logs and analyzer output from the working directory. The
  HTTP API can only accept what a caller already assembled. Keeping both means
  the assembly logic has to live outside Augur for every HTTP caller.
- **A port is a surface.** Dropping the listener drops the loopback binding, the
  host policy, and the health endpoint that exists only to prove the process is
  up.

## Callers

The HTTP API has **one** caller, and it is not hypothetical:

- **Anatomia** — `src/adapters/web/routes/test-suggestions.ts` mounts
  `POST /api/projects/:id/test-suggestions` (`src/adapters/web/server.ts`), shapes
  a `CreatePlanRequest` from the analysed project plus the user's objective, and
  `POST`s it to `${ANATOMIA_AUGUR_URL || AUGUR_URL || http://127.0.0.1:4210}/v1/plans`.
  It is surfaced as the **Test Suggestions** tab in the Anatomia web dashboard and
  covered by `src/adapters/__tests__/web.test.ts`.

Everything else that names Augur is a registration or a description, not a call:
the Excubitor catalog entry (`provides: AUGUR_URL`, which **no catalog entry
consumes**) and the LUDIARS service map (`service-map.json`, `ServiceMap.md`,
"port 4210" in the role text).

**Removing the server without migrating Anatomia breaks a shipped feature.** Step
A3 is gated on that migration; see [A3](#a3--remove-the-daemon).

> Recorded because an earlier draft of this document claimed there were no
> callers. That claim came from a workspace-wide search that silently matched
> nothing — the sub-repositories are ignored from the workspace root, so the
> search covered no repository at all. A per-repository search found the caller
> immediately. A negative result from a search that was never scoped to the
> thing being searched is not evidence.

## What this costs, and what happens instead

| Loss | Replacement |
| --- | --- |
| Warm process, catalog parsed once | Each invocation re-reads a static catalog. Measure before optimising; if it matters, cache the compiled catalog on disk rather than reintroducing a daemon. |
| The one existing HTTP caller (Anatomia, see [Callers](#callers)) | `augur plan --request -`, a `CreatePlanRequest` read from stdin. Anatomia already assembles the whole request, so it needs the engine, not the signal gathering. |
| Remote callers | There are none: the only caller is a local process on the same workstation. If a remote one appears, `augur plan` over SSH, or a thin caller-owned HTTP wrapper, is enough — the wrapper is not Augur's problem. |
| CLI↔HTTP parity test (Phase 3 acceptance) | Golden tests on `createPlan` keep the engine contract. Parity between two surfaces stops being a thing to prove when there is one surface. |
| Phase 5 persistence assumed an HTTP layer stamping plan ids | The CLI stamps the id and writes to a local store path. [Plan Persistence](../data/persistence.md) needs a revision before Phase 5 starts; it is not blocked by this decision. |
| `GET /v1/health` for Excubitor | Nothing to health-check. The catalog entry is removed rather than replaced. |

## Migration

Sequenced so nothing is removed before its replacement exists.

### A1 — Add the CLI (additive, server untouched) — **done**

- `src/cli/` per the module layout: `main.ts` (argv dispatch), `args.ts` (argv
  parsing and the `UsageError` that maps to exit `1`), `plan.ts`, `reviewPlan.ts`,
  `gather.ts` (git/file signal gathering), `format.ts`.
  Dependency direction stays one-way: `cli → engine → catalog/schema`.
  `args.ts` knows nothing about the engine: it turns tokens into flags, and each
  command declares which flags it accepts so a mistyped option is a usage error
  rather than a silently ignored one. Parsing itself stays permissive because
  `augur inject` forwards its own flag surface through the same argv.
- `bin/augur.mjs` — the entry other tools invoke as
  `node <augurFolder>/bin/augur.mjs <subcommand>`. It resolves the
  implementation in this order:
  1. `dist/cli/main.js` when a build is present;
  2. otherwise re-execute `process.execPath` with `--experimental-strip-types`
     on `src/cli/main.ts`.
  The shim exists because Node before 22.18 does not strip types without the
  flag, and Revisor invokes `process.execPath` directly with no shell.
  As implemented, the shim does not branch on the Node version: it attempts the
  import and re-executes with the flag only when Node actually rejects the `.ts`
  extension. The test is then what this Node does, not what its version implies,
  and a future default cannot make the version check stale. The re-executed entry
  is `bin/augur.mjs` itself, not `src/cli/main.ts`: that module only exports
  `main`, so running it as the entry point would exit `0` having planned nothing.
  A failure to load the implementation at all exits `2`, not `1` — it is an
  internal error, not the caller asking wrong.
- Subcommands: `plan` ([CLI](../interface/cli.md)), `review-plan`
  ([Review Plan CLI](../interface/review-plan-cli.md)), and `inject` (the
  existing `npm run inject` tool, [inject CLI](../interface/inject-cli.md)),
  which becomes a subcommand rather than a second entry point.
- `augur plan --request -` reads a complete `CreatePlanRequest` on stdin and
  skips signal gathering entirely. This is the direct replacement for
  `POST /v1/plans` and is what Anatomia needs: it has already assembled the
  request from its own analysis and must not have Augur re-derive anything from
  a working directory it does not own.
- `package.json` gains `"bin": { "augur": "bin/augur.mjs" }`.

Acceptance: `augur plan` satisfies the flag surface and exit codes in the CLI
spec; `augur review-plan` satisfies the Revisor contract; golden tests unchanged.

### A2 — Point Revisor at the CLI

Already implemented on the Revisor side: setting `planAdvisor: "augur"` with an
`augurFolder` makes Revisor call `bin/augur.mjs review-plan --json`. A missing
or failing CLI leaves Revisor's deterministic plan in force, so A2 is safe to
land before A1 and simply does nothing until A1 exists.

### A2b — Migrate Anatomia off the HTTP API

**A3 must not start until this lands.** Anatomia's Test Suggestions tab is the
only HTTP caller and it is a shipped feature.

- Anatomia replaces the `fetch` in `src/adapters/web/routes/test-suggestions.ts`
  with a spawn of `node <augurFolder>/bin/augur.mjs plan --request - --json`,
  writing the `CreatePlanRequest` it already builds to stdin. The request shape,
  the response shape, and the route's own contract do not change; only the
  transport does.
- `ANATOMIA_AUGUR_URL` / `AUGUR_URL` are replaced by an Augur checkout path, the
  same way Anatomia is already located by path from Revisor.
- Anatomia's existing tests stub the transport rather than the URL.

**This is a change to `LUDIARS/Anatomia` and is a required follow-up outside this
repository.** Augur cannot land A3 unilaterally.

### A3 — Remove the daemon

Requires A1 and A2b.

- Delete `src/server.ts`, `src/app.ts`, `src/routes/`.
- Drop `hono`, `@hono/node-server`, and `pino` (logging becomes stderr writes;
  a CLI has no log pipeline to feed).
- Replace `npm start` with the CLI; keep `npm run build` for `dist/`.
- Mark [HTTP API](../interface/http-api.md) superseded, keeping the request and
  response examples as the `CreatePlanRequest`/`PlanResponse` reference they
  already are — the schema outlives the transport.
- Remove the `augur` service entry from the Excubitor catalog
  (`LUDIARS/Excubitor`, `catalog/services.yaml`) and drop the port from the
  LUDIARS service map (`service-map.json`, `ServiceMap.md`: "port 4210" in
  Augur's role text). **Both are changes to other repositories and are required
  follow-ups, not part of an Augur PR.**
- Update [Roadmap](../roadmap.md): Phase 2 becomes superseded, Phase 3 becomes
  the delivery surface.

Acceptance: no listener is created by any code path; no `hono`, no `AUGUR_PORT`,
and no port binding remain **in this repository**; Anatomia's Test Suggestions
tab still works against the CLI; the engine's golden tests are untouched by the
removal.

Scope every verifying search to a repository. A search rooted at the workspace
directory matches nothing, because the sub-repositories are ignored from there —
that is how the caller above was missed in the first place.

## Constraints that do not change

- Augur never executes tests, never mutates a repository, and never uses the
  network. Only the CLI layer shells out, and only to `git`.
- The engine receives data and returns a plan. Adding a transport, or removing
  one, must not move logic into the CLI layer.
- `--json` output goes to stdout with nothing else on stdout, so a caller can
  consume it directly. Diagnostics go to stderr.

## Related

- [CLI](../interface/cli.md)
- [Review Plan CLI](../interface/review-plan-cli.md)
- [HTTP API](../interface/http-api.md)
- [Implementation Design](../implementation-design.md)
- [Roadmap](../roadmap.md)
