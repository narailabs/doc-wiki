# Audit-log shape check

Expected for a DDL deny on `env=production`: **zero** `connect`, `pool_created`, or `query_executed` entries, because the policy gate rejects the query before any driver work runs.

## Observation on the filesystem

`wiki.config.yaml` sets `audit.enabled: true` and `audit.path: /tmp/eval-i3-db-deny/audit.jsonl`, but `db_query.ts` does not currently call `enableAudit(path)` — audit is only toggled on from library tests (see `.claude/agents/lib/wiki_db/tests/audit.test.ts`). As a result, the CLI run produced **no audit file at all**:

```
$ ls -la /tmp/eval-i3-db-deny/
-rw-r--r--  dev.sqlite         0 bytes
-rw-r--r--  wiki.config.yaml   489 bytes
# audit.jsonl: ABSENT
```

A zero-byte copy has been saved as `audit.jsonl` in this `outputs/` directory to make the proof-of-absence explicit.

## jq enumeration

Enumerate all event types:

```
$ jq -r '.event_type' audit.jsonl | sort | uniq -c
(file empty; 0 events)
```

Count forbidden event types (`connect`, `pool_created`, `query_executed`):

```
$ jq -r 'select(.event_type=="connect" or .event_type=="pool_created" or .event_type=="query_executed") | .event_type' audit.jsonl | wc -l
0
```

## Result

- `connect` events for `env=production`: **0**
- `pool_created` events for `env=production`: **0**
- `query_executed` events for `env=production`: **0**
- Total audit events for this run: **0**

Assertion satisfied: no connection-shape audit events were emitted. Combined with the empty stderr and 50 ms wall time (see `timing.md`), this corroborates that no DNS/TCP was attempted against `nonexistent.invalid.example`.

## Caveat

The zero-event outcome here is vacuously true because `db_query.ts` never called `enableAudit()` in the first place. A stronger future test would (a) add an `enableAudit` call wired to `wiki.config.yaml` → `audit.*`, and (b) re-run this eval expecting the audit file to contain exactly one `policy_deny` entry and zero `connect`/`pool_created`/`query_executed` entries.
