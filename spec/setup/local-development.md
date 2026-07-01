# Local Development Setup

## Status

Implementation has not started.

This document defines the expected setup direction for the Augur project.

## Runtime

The MVP should use a TypeScript runtime unless implementation constraints change.

Expected tooling:

- Node.js
- npm
- TypeScript
- a test runner such as Vitest
- an HTTP server framework selected during implementation

## Environment Variables

No required environment variables are defined for the MVP.

Future optional variables may include:

- `AUGUR_PORT`
- `AUGUR_LOG_LEVEL`
- `AUGUR_LLM_PROVIDER`
- `AUGUR_LLM_API_KEY`

## Local Commands

Command names should be finalized when `package.json` is created.

Expected commands:

```text
npm run dev
npm run build
npm run test
npm run lint
```

## Local Startup

Expected startup flow:

1. Install dependencies.
2. Run the development server.
3. Call `GET /v1/health`.
4. Call `POST /v1/plans` with a sample request.

## Deployment

Deployment is not defined yet.

The MVP should avoid deployment-specific assumptions in core planning logic.

