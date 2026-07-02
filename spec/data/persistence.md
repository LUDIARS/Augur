# Plan Persistence

## Purpose

Phase 5 design: optional storage of issued plans so callers can retrieve, share, and audit them later. Persistence is **off by default**; without it Augur remains fully stateless, exactly as Phases 0–4 ship.

## Design Decisions

- **The engine stays pure.** `createPlan` neither knows nor cares about storage. The HTTP layer stamps identity (`planId`, `createdAt`) onto the response *after* the engine returns and saves the record. Golden tests and ST-007 determinism are untouched because they exercise the engine, not the stamped envelope.
- **Storage is an interface, not a database choice.** Phase 5 ships a single-file SQLite store; tests use an in-memory store. Nothing outside `src/store/` may import a database driver.
- **Records are immutable.** A stored plan is a historical fact; there is no update endpoint. Correcting a plan means issuing a new one.

## Configuration

| Variable | Meaning |
| --- | --- |
| `AUGUR_DB_PATH` | path to the SQLite file; unset disables persistence entirely |
| `AUGUR_RETENTION_DAYS` | optional; records older than this are eligible for deletion by the retention sweep |

## PlanRecord

The stored shape. The [Core Data Schema](./core-schema.md) remains the source of truth for the embedded types.

```ts
type PlanRecord = {
  planId: string;        // "plan_" + 26-char Crockford ULID, minted by the HTTP layer
  createdAt: string;     // ISO 8601 UTC, stamped by the HTTP layer
  engineVersion: string; // package version that produced the plan, for replay/debugging
  request: CreatePlanRequest;
  response: PlanResponse; // as returned, without planId/createdAt stamped into it
};
```

`planId` uses a ULID so records sort by creation time; identity generation lives in the HTTP layer because the engine bans time and randomness.

## Response Stamping

When persistence is enabled, `POST /v1/plans` responses carry two additional optional fields:

```ts
type PlanResponse = {
  planId?: string;    // present only when the plan was persisted
  createdAt?: string; // present only when the plan was persisted
  summary: string;
  testPlan: TestPlan;
  fixPolicy: FixPolicy;
  evidence: Evidence[];
};
```

Backward compatible by construction: existing clients ignore unknown optional fields, and with persistence disabled the response is byte-identical to Phase 2 output (roadmap Phase 5 acceptance).

## Store Interface

```ts
interface PlanStore {
  save(record: PlanRecord): Promise<void>;
  get(planId: string): Promise<PlanRecord | undefined>;
  delete(planId: string): Promise<boolean>; // true if a record existed
  sweep(olderThan: string): Promise<number>; // retention; returns deleted count
}
```

A `save` failure does not fail the request: the plan is still returned, without `planId`, and the failure is logged. Producing plans is the service's job; storage is a convenience layered on top.

## API Additions

Defined in the [HTTP API](../interface/http-api.md):

- `GET /v1/plans/{planId}` — returns the stored `PlanResponse` with `planId`/`createdAt` stamped; `404` with the standard envelope when unknown.
- `DELETE /v1/plans/{planId}` — caller-controlled deletion (stored plans contain request signals — diffs, logs — that callers may need to purge); `204` on success, `404` when unknown.
- Both endpoints return `404` with `code: "not_found"` when persistence is disabled, since no plan can exist.

Listing (`GET /v1/plans`) is deliberately deferred: retrieval-by-id covers the audit and share use cases, and listing forces pagination/filtering decisions better made against real usage.

## Privacy and Retention

Stored records contain everything the caller sent. Consequences:

- `DELETE` is part of the minimum surface, not an afterthought.
- The retention sweep runs opportunistically at startup and daily thereafter when `AUGUR_RETENTION_DAYS` is set; deletion is permanent.
- No records are ever written when `AUGUR_DB_PATH` is unset — "off by default" means nothing touches disk.

## Testing

- Store contract tests run against both the SQLite and in-memory implementations (same suite, two fixtures).
- API tests cover: persisted response carries `planId`; `GET` round-trips the stored response; `DELETE` then `GET` yields `404`; disabled persistence leaves responses byte-identical to Phase 2 golden output.
- The safety suite's purity scan continues to cover `src/engine`, `src/catalog`, `src/schema` — `src/store` is intentionally outside the pure zone, and a test asserts the engine does not import it.

## Related Specs

- [Core Data Schema](./core-schema.md)
- [HTTP API](../interface/http-api.md)
- [Implementation Design](../implementation-design.md)
- [Roadmap](../roadmap.md) — Phase 5
