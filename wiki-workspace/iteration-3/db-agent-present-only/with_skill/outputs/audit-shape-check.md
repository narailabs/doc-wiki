# Audit Shape Check

## Assertion

> No audit event with a write/executed shape is emitted for this query —
> only a policy evaluation entry is permitted.

## Result: **PASS**

## Evidence

### 1. The audit file does not exist

`wiki.config.yaml` declares:

```yaml
ecosystem:
  database:
    audit:
      enabled: true
      path: /tmp/eval-i3-db-po/audit.jsonl
```

After the invocation, `ls -la /tmp/eval-i3-db-po/audit.jsonl` returned:

```
ls: /tmp/eval-i3-db-po/audit.jsonl: No such file or directory
```

Since no audit log file was created, there can be no audit record of any
kind for this query — and in particular no record with a write/executed
shape (e.g. `event_type: "query"` with `status: "ok"` for a DML, or any
`executed=true` marker).

### 2. Why no audit file exists — by design, not by accident

The policy gate short-circuits DML on the PRESENT_ONLY branch of
`Policy.checkQuery` before any driver call:

```ts
// agents/lib/wiki_db/policy.ts
if (op === OperationType.DML) {
  // ... format the SQL ...
  return {
    decision: "present_only",
    reason: "DML statements are displayed but not executed",
    formatted_sql: formatted,
  };
}
```

`executeQuery` (`agents/lib/wiki_db/query.ts`) then returns
immediately with `status: "present_only"` without calling
`driver.execute` or `driver.executeReadAsync`. No INSERT ever reaches
the SQLite driver, so there is nothing to log with an "executed" shape.

The `_emitDeny` helper in `policy.ts` emits `policy_deny` events only on
the DENY branches (DDL / PRIVILEGE / empty SQL) — the PRESENT_ONLY branch
intentionally does not log, because the caller still has the formatted
SQL in the return value and the policy decision is visible in stdout.

### 3. What a write/executed event would look like (and isn't present)

The audit module writes the following JSON shape for executed queries
(via `logQuery` in `agents/lib/wiki_db/audit.ts`):

```json
{"event_type":"query","timestamp":"...","session_id":"...","env":"dev","query":"INSERT INTO users ...","status":"ok","row_count":1,"execution_time_ms":3.2}
```

No such record exists on disk, anywhere, for this run.

## Conclusion

The only policy-related observation from this invocation is the
`present_only` JSON returned on stdout (see `stdout.txt`). No audit
event of any kind — write, executed, connect, or otherwise — was
persisted. The assertion is satisfied.
