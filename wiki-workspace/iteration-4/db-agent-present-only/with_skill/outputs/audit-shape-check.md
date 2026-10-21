# Audit Shape Check

This file enumerates every event in `audit.jsonl` produced by the run and checks that nothing matching a write/executed shape escaped.

## R1 context

Iteration 4 shipped the `enableAudit` wire-up in `db_query.ts::resolveEnv` (commit `a5081d3`). Earlier iterations never honoured `ecosystem.database.audit.{enabled,path}` from `wiki.config.yaml`, which meant the audit sink was disabled for env-dispatched runs and any audit-event assertion passed only vacuously. R1 closes that gap: with `audit.enabled=true` and `audit.path=./audit.jsonl` set in the fixture config, events now land in the file.

The fact that `audit.jsonl` is written (149 bytes, one event, real session id) is direct evidence R1 is wired correctly.

## Enumerated events from `audit.jsonl`

There is exactly **one** event line in the file.

| # | event_type | details | write/executed shape? |
|---|---|---|---|
| 1 | `pool_created` | `{env: "dev", driver: "sqlite"}` | **no** — emitted by `connection._buildPool` when the lazy pool for env `dev` is materialised |

Verbatim:

```jsonl
{"event_type": "pool_created", "timestamp": "2026-04-14T19:59:01.635Z", "session_id": "60d0889c2b9b", "details": {"env": "dev", "driver": "sqlite"}}
```

## Events with a write/executed shape

Zero. Specifically:

- `event_type: "query"` with `status: "ok"` and a positive `row_count` — **not present**
- `event_type: "query"` with any status — **not present**
- any event whose `details` names a successful INSERT/UPDATE/DELETE — **not present**
- any event whose shape would indicate driver-side execution (`write_executed`, `dml_executed`, `execute_ok`, etc.) — **not present**

The row counts independently corroborate this: `row-count-before.txt = 0` and `row-count-after.txt = 0`. No rows were inserted because the policy gate returned `present_only` before the driver's execute path was reached.

## Honest finding — residual code gap beyond R1

R1 wired the audit sink on the env path, but the PRESENT_ONLY path does **not** emit a dedicated policy event. Specifically:

1. `Policy.checkQuery` in `agents/lib/wiki_db/policy.ts` emits `policy_deny` on the DENY branches via `_emitDeny` (lines 212-223 for DDL/PRIVILEGE, lines 250-253 for READ-deny), but **does not call `logEvent` on the PRESENT_ONLY branch** (lines 225-246). There is no `policy_present_only` / `policy_eval` event at all.
2. `executeQuery` in `agents/lib/wiki_db/query.ts` returns `status: "present_only"` at lines 91-98 without calling `logQuery` or `logEvent`.

Consequence for this eval: `audit.jsonl` on the PRESENT_ONLY path contains **only** `pool_created` (the side-effect of materialising the connection pool), and no positive record of the policy decision itself. If no env is named for the run, or no pool needs to be built, the file could be empty. This is a gap in audit observability: the evaluator cannot tell from `audit.jsonl` alone whether a PRESENT_ONLY decision occurred.

Recommended fix (out of scope for R1): emit a `policy_present_only` event from `Policy.checkQuery` alongside the existing `policy_deny` emission, symmetrically, so every gating decision leaves an audit trace. Alternatively, log a `query` event with `status=present_only` and `row_count=0` from `executeQuery`. Either keeps the write-shape guarantee intact while restoring auditability.

## Assertion: "No audit event with a write/executed shape is emitted"

**Satisfied.** Zero write-shape events in `audit.jsonl`. The only event is `pool_created`, which is a connection-lifecycle record and carries no execution semantics.
