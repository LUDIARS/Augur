# Local Development Setup

## Status

Augur is daemon-optional. The CLI is the canonical surface; `augur serve` starts
the loopback HTTP adapter when another process needs HTTP, and `augur mcp` starts
the stdio MCP adapter for an agent session. Both adapters call the same test
operations layer as `augur tests ...` and keep no process-local test state.

## Runtime

The MVP should use a TypeScript runtime unless implementation constraints change.

Expected tooling:

- Node.js
- npm
- TypeScript
- Vitest
- Hono + @hono/node-server (see the [Implementation Design](../implementation-design.md) for the full technology choices)

## Configuration

Defaults live in `augur.config.json` (committed, non-secret): `port` (4210 — a copy of the Excubitor catalog entry, which is the source of truth), `logLevel`, buses, repository paths, run-cache retention, authoring model, and `dataDir`. The server binds to loopback only (tier: personal, see `spec/design.md`).

Each managed repository owns two tracked files:

- `.augur/tests.config.json` — repository id, runner commands, default bus,
  quota, retirement policy, layout, and timeout.
- `.augur/tests.jsonl` — one validated `TestRecord` per line, rewritten in id
  order. It is branch content and therefore treated as untrusted input.

Run records, verdicts, and Revisor flag results are machine-local under
`AUGUR_DATA_DIR`, `augur.config.json`'s `dataDir`, or the default
`<augurFolder>/.augur-data/`, in that precedence order.

## Environment Variables

No required environment variables are defined.

Optional variables by phase:

- `AUGUR_PORT`, `AUGUR_LOG_LEVEL` — override `augur.config.json`; invalid values fail fast instead of falling back silently
- `AUGUR_DATA_DIR` — override the machine-local run cache directory
- `AUGUR_ANATOMIA_DIR` — Anatomia checkout used for PR impact analysis (default `../Anatomia`)
- `AUGUR_REVISOR_URL` — Revisor base URL used by `augur tests flag`
- `AUGUR_LLM_PROVIDER`, `AUGUR_LLM_API_KEY`, `AUGUR_LLM_MODEL`, `AUGUR_LLM_TIMEOUT_MS` — Phase 4, see [LLM Assistance](../feature/llm-assistance.md)
- `AUGUR_DB_PATH`, `AUGUR_RETENTION_DAYS` — Phase 5, see [Plan Persistence](../data/persistence.md)

The planning engine is deterministic and requires no API keys; every optional feature above is off when its variables are unset. See the [Planning Engine](../feature/planning-engine.md) spec.

## Local Commands

```text
npm run dev            # start the HTTP server with reload
npm start              # start `augur serve` without reload
npm run augur -- mcp   # start the stdio MCP server
npm run augur -- tests lint --repo .
npm run augur -- tests run --repo . --bundle all --json
npm run build          # type-check and emit dist/
npm run test           # unit, golden, API, and safety suites
npm run lint           # eslint, including engine determinism bans
npm run golden:update  # regenerate golden expectations (explicit, never automatic)
```

## Local Startup

1. `npm install` (with dev dependencies; if your shell exports `NODE_ENV=production`, run `NODE_ENV=development npm install --include=dev`)
2. Use `npm start` (or `npm run dev` while editing) for the optional HTTP API.
3. Call `GET http://127.0.0.1:4210/v1/health` or a `/v1/tests/*` route.
4. Use `node bin/augur.mjs mcp` for stdio clients; it does not open a port.
5. Use `node bin/augur.mjs tests ...` when no adapter process is needed.

## Deployment

Deployment is not defined yet.

The MVP should avoid deployment-specific assumptions in core planning logic.

