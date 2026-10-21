# audit.jsonl shape check

Invocation wrote exactly **2** JSONL events to `/tmp/eval-i4-db-deny/audit.jsonl`.

## Event enumeration

| # | event_type      | session_id    | details                                                              |
|---|-----------------|---------------|----------------------------------------------------------------------|
| 1 | `pool_created`  | b667d013f0d6  | `{ env: "production", driver: "postgresql" }`                        |
| 2 | `policy_deny`   | b667d013f0d6  | `{ reason: "DDL statements are never allowed", op: "ddl" }`          |

## Counts

| check                                  | expected | observed | result |
|----------------------------------------|----------|----------|--------|
| `count(policy_deny) >= 1`              | >= 1     | 1        | PASS   |
| `count(query_executed) == 0`           | 0        | 0        | PASS   |
| `count(connect) == 0`                  | 0        | 0        | PASS   |

## `pool_created` caveat (R1 note)

The spec explicitly calls this out: `pool_created` **is expected** and is
**not** evidence of a real connection.

- In the pg driver, `pool_created` is emitted at `new pg.Pool(...)` time.
  `pg.Pool`'s constructor is synchronous and does **not** perform DNS
  resolution or open a TCP socket — it only stores config. A real
  connection only happens on `pool.connect()` (or first `pool.query`),
  and that call is never reached on a DDL statement because the policy
  gate returns `deny` first.
- Corroborating evidence in this run:
  - `stderr.txt` is **empty**. A real DNS lookup against
    `nonexistent.invalid.example` would have surfaced `ENOTFOUND`
    (or at best `ECONNREFUSED` if DNS happened to resolve).
  - Wall time is **0.046 s**. A DNS timeout or TCP RTT would cost
    tens-to-hundreds of ms, which is not what we observed.
  - There is no `connect` event, no `query_executed` event, and no
    driver-error event in the log.
- Hence `pool_created` here is a pure in-process bookkeeping signal, not
  a network event. This is the same property that lets the policy gate
  fire before the driver is invoked.

## Raw audit.jsonl

```
{"event_type": "pool_created", "timestamp": "2026-04-14T19:58:54.206Z", "session_id": "b667d013f0d6", "details": {"env": "production", "driver": "postgresql"}}
{"event_type": "policy_deny", "timestamp": "2026-04-14T19:58:54.208Z", "session_id": "b667d013f0d6", "details": {"reason": "DDL statements are never allowed", "op": "ddl"}}
```

Timestamps are 2 ms apart — consistent with pool construction and
immediate policy evaluation, no I/O in between.
