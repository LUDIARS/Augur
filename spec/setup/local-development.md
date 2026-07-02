# Local Development Setup

## Status

Roadmap Phases 0–2 are implemented: scaffolding, the core planning engine, and the HTTP API. Phases 3–5 (CLI, LLM assistance, persistence) are not started. See the [roadmap](../roadmap.md).

## Runtime

The MVP should use a TypeScript runtime unless implementation constraints change.

Expected tooling:

- Node.js
- npm
- TypeScript
- Vitest
- Fastify (see the [Implementation Design](../implementation-design.md) for the full technology choices)

## Environment Variables

No required environment variables are defined for the MVP.

Future optional variables may include:

- `AUGUR_PORT`
- `AUGUR_LOG_LEVEL`
- `AUGUR_LLM_PROVIDER` (Phase 4 only, see [roadmap](../roadmap.md))
- `AUGUR_LLM_API_KEY` (Phase 4 only)

The MVP planning engine is deterministic and requires no API keys. See the [Planning Engine](../feature/planning-engine.md) spec.

## Local Commands

```text
npm run dev            # start the HTTP server with reload
npm run build          # type-check and emit dist/
npm run test           # unit, golden, API, and safety suites
npm run lint           # eslint, including engine determinism bans
npm run golden:update  # regenerate golden expectations (explicit, never automatic)
```

## Local Startup

1. `npm install`
2. `npm run dev`
3. Call `GET /v1/health`.
4. Call `POST /v1/plans` with a sample request (see [HTTP API](../interface/http-api.md)).

## Deployment

Deployment is not defined yet.

The MVP should avoid deployment-specific assumptions in core planning logic.

