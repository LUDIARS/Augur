# Bounded contract-log aggregation (SPEC-CONTRACT-LOG-STREAMING)

Specification ID: SPEC-CONTRACT-LOG-STREAMING

Actio: 4088d999-acb6-463f-aea8-3f5abc791f71. Human start: neco, 2026-10-11, shared test record aggregation failure「これ対応」.

## Responsibility and invariants

`contract-observation` owns the report, not log retention. Its filesystem adapter yields UTF-8 JSONL lines in sorted filename order; the collection use case normalizes one event at a time; a pure accumulator owns counters and only the newest three reasons per contract. Both report entry points use the same collector.

Preserve contract/marker authentication, inclusive time windows, undated/foreign diagnostics, manifest order, latest-reason time/order ties, acceptance conditions and JSON shape. Invalid JSON and non-contract events remain ignored. Preserve CRLF and an unterminated final line. Missing/non-directory log paths still supply no evidence. I/O errors reject the entire collection; no partial successful report is returned.

## Resource bounds

Read 64 KiB UTF-8 chunks, letting Node's decoder preserve split multi-byte characters. Retain at most one line, bounded to 8 Mi UTF-16 code units (excluding LF, including CR). Reject a larger line with filename and limit, never silently skip it. This is a new explicit input boundary to avoid replacing a whole-file overflow with an unterminated-line overflow. Do not print line contents in errors.

Memory scales with directory entries, the fixed line bound, and declared contracts/latest-three reasons, not total events or file size. Scan time remains linear in input bytes; this change does not add indexing or promise that all scans fit the caller's timeout. The stream owner destroys streams on success, error and early return. No log truncation, relocation, rotation, or retention-policy change.

## Verification and recovery

Reader coverage: file order, blanks, UTF-8 crossing chunk boundaries, CRLF, final line, oversized line rejection, I/O failure and resource cleanup. Collector coverage: a generated input larger than a constrained child heap, counters/reasons matching expected results, no full-file materialization. Existing aggregation, report CLI, acceptance and tests-report regressions preserve semantics.

Revert the implementation commit to restore previous behavior; logs remain untouched. The CLI prefers built `dist/` when present, so reflection requires updating that build in the original Augur checkout after merge. No server restart is intrinsically required for new CLI invocations.

Session-authored checks are not represented as executed tests. Revisor execution and merge evidence are recorded in the task/PR.
