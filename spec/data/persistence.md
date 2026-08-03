# Plan Persistence

## Purpose

Phase 5 design: optional storage of issued plans so callers can retrieve, share, and audit them later. Persistence is **off by default**; without it Augur remains fully stateless, exactly as Phases 0–4 ship.

## Design Decisions

- **The engine stays pure.** `createPlan` neither knows nor cares about storage. The CLI layer stamps identity (`planId`, `createdAt`) onto the response *after* the engine returns and saves the record. Golden tests and ST-007 determinism are untouched because they exercise the engine, not the stamped envelope.
- **Storage is an interface, not a database choice.** Phase 5 ships a single-file SQLite store; tests use an in-memory store. Nothing outside `src/store/` may import a database driver.
- **Records are immutable.** A stored plan is a historical fact; there is no update subcommand. Correcting a plan means issuing a new one.

## Configuration

| Variable | Meaning |
| --- | --- |
| `AUGUR_DB_PATH` | path to the SQLite file; unset disables persistence entirely |
| `AUGUR_RETENTION_DAYS` | optional; records older than this are eligible for deletion by the retention sweep |

## PlanRecord

The stored shape. The [Core Data Schema](./core-schema.md) remains the source of truth for the embedded types.

```ts
type PlanRecord = {
  planId: string;        // "plan_" + 26-char Crockford ULID, minted by the CLI layer
  createdAt: string;     // ISO 8601 UTC, stamped by the CLI layer
  engineVersion: string; // package version that produced the plan, for replay/debugging
  request: CreatePlanRequest;
  response: PlanResponse; // as returned, without planId/createdAt stamped into it
};
```

`planId` uses a ULID so records sort by creation time; identity generation lives in the CLI layer because the engine bans time and randomness.

## Response Stamping

When persistence is enabled, the `PlanResponse` an `augur plan` run prints carries two additional optional fields:

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

Backward compatible by construction: existing clients ignore unknown optional fields, and with persistence disabled the response is byte-identical to the Phase 1 engine output (roadmap Phase 5 acceptance).

## Store Interface

```ts
interface PlanStore {
  save(record: PlanRecord): Promise<void>;
  get(planId: string): Promise<PlanRecord | undefined>;
  delete(planId: string): Promise<boolean>; // true if a record existed
  sweep(olderThan: string): Promise<number>; // retention; returns deleted count
}
```

A `save` failure does not fail the run: the plan is still returned, without `planId`, and the failure is logged. Producing plans is the tool's job; storage is a convenience layered on top.

## Subcommand Additions

Added to the [CLI](../interface/cli.md) surface when Phase 5 lands. Augur has no daemon and no port, so a
stored plan is reached by running the tool, not by requesting a route
([Daemon-less CLI](../plan/daemonless-cli.md)).

- `augur plans get <planId> [--json]` — prints the stored `PlanResponse` with
  `planId`/`createdAt` stamped. Exit `1` with the message on stderr when the id
  is unknown, matching the CLI exit-code contract (`0` produced, `1` usage or
  validation, `2` internal).
- `augur plans delete <planId>` — caller-controlled deletion (stored plans
  contain request signals — diffs, logs — that callers may need to purge).
  Exit `0` when a record was removed, `1` when the id is unknown.
- Both exit `1` when persistence is disabled, since no plan can exist. The
  message says persistence is off rather than that the id is unknown: a caller
  who forgot to set `AUGUR_DB_PATH` must not read it as a missing record.

`augur plan` prints the `planId` it minted to stderr when persistence is on, so
a pipeline consuming stdout as one JSON document is unaffected.

Listing (`augur plans list`) is deliberately deferred: retrieval-by-id covers the
audit and share use cases, and listing forces pagination/filtering decisions
better made against real usage.

## Privacy and Retention

Stored records contain everything the caller sent. Consequences:

- `augur plans delete` is part of the minimum surface, not an afterthought.
- The retention sweep runs opportunistically when an invocation opens the store and the last sweep is more than a day old (there is no resident process to schedule it), and only when `AUGUR_RETENTION_DAYS` is set; deletion is permanent.
- No records are ever written when `AUGUR_DB_PATH` is unset — "off by default" means nothing touches disk.

## Testing

- Store contract tests run against both the SQLite and in-memory implementations (same suite, two fixtures).
- CLI tests cover: a persisted run carries `planId`; `plans get` round-trips the stored response; `plans delete` then `plans get` exits `1`; disabled persistence leaves `augur plan --json` byte-identical to the golden output.
- The safety suite's purity scan continues to cover `src/engine`, `src/catalog`, `src/schema` — `src/store` is intentionally outside the pure zone, and a test asserts the engine does not import it.

## Related Specs

- [Core Data Schema](./core-schema.md)
- [CLI](../interface/cli.md)
- [Daemon-less CLI](../plan/daemonless-cli.md)
- [HTTP API](../interface/http-api.md) — removed transport, retained as the request/response reference
- [Implementation Design](../implementation-design.md)
- [Roadmap](../roadmap.md) — Phase 5
