# audit.jsonl — shape check

Verifies that the audit trail produced during schema introspection contains
only READ-shape events (no `write`, no `ddl`, no `privilege`, no
`executed=true` for INSERT/UPDATE/DELETE/DROP/CREATE). This is assertion #4
in `eval_metadata.json`.

## 1. All event types emitted

```bash
$ jq -r '.event_type' audit.jsonl
pool_created
```

Only one event, and it is read-side: `pool_created` fires once per env on the
first `getConnection()` call (see `connection.ts::_buildPool` →
`logEvent({event_type: "pool_created", ...})`). The schema action dispatches
through `SQLiteDriver.getSchema()` which only runs PRAGMA + sqlite_master
lookups — no `query` event is emitted by the agent because no SQL was routed
through `executeQuery`.

## 2. Count of write/ddl/privilege/executed-write events

```bash
$ jq -s '[.[] | select(
    .event_type=="write"
    or .event_type=="ddl"
    or (.details.op=="write")
    or (.details.op=="ddl")
    or (.details.op=="privilege")
    or (.executed==true and (.op|test("INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|TRUNCATE|GRANT|REVOKE"; "i")))
)] | length' audit.jsonl
0
```

## 3. Count of policy_deny events (should be 0 for an allow path)

```bash
$ jq -s '[.[] | select(.event_type=="policy_deny")] | length' audit.jsonl
0
```

## 4. Count of query events (executed SQL audit records)

```bash
$ jq -s '[.[] | select(.event_type=="query")] | length' audit.jsonl
0
```

## Conclusion

`audit.jsonl` contains exactly one event (`pool_created`) and zero write /
DDL / privilege / executed-mutation records. The assertion "audit.jsonl
contains only read-side events" passes.
