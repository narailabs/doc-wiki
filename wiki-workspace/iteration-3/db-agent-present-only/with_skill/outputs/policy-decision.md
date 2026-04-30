# Policy Decision

| Field | Value |
|---|---|
| `policy_gate` | **PRESENT_ONLY** |
| `final_decision` | `present_only` |
| `executed` | `false` |
| `env` | `dev` |
| `driver` | `sqlite` |
| `approval_mode` | `auto` |
| `operation_type` | `DML` (INSERT) |
| `rule_cited` | DML classifier — `INSERT` matches `_DML_KEYWORDS` in `classifySqlKeywords` |
| `reason` | `DML statements are displayed but not executed` |

## Rule citation (verbatim from source)

File: `agents/lib/wiki_db/policy.ts`

```ts
const _DML_KEYWORDS: ReadonlySet<string> = new Set([
  "INSERT", "UPDATE", "DELETE", "REPLACE", "MERGE", "UPSERT",
]);

// ...

// ----- DML: present only (show the SQL, do not execute) -----
if (op === OperationType.DML) {
  let formatted = Policy._stripComments(stripped);
  // ... capitalize leading keyword ...
  return {
    decision: "present_only",
    reason: "DML statements are displayed but not executed",
    formatted_sql: formatted,
  };
}
```

## Classification chain

1. **Input:** `INSERT INTO users (name, email) VALUES ('Test', 'test@example.com')`
2. **First token (uppercased):** `INSERT`
3. **Keyword set hit:** `_DML_KEYWORDS` contains `INSERT` → `OperationType.DML`
4. **Decision:** `Decision.PRESENT_ONLY` (DML branch in `checkQuery`)
5. **Driver call:** **never reached** — `executeQuery` returns the
   `present_only` result without invoking `driver.execute` or
   `driver.executeReadAsync`.
   (See `agents/lib/wiki_db/query.ts`, lines 91-98.)

## Observable consequences

- Row count is `0` both before and after the invocation (see
  `row-count-before.txt` and `row-count-after.txt`).
- No write-shaped audit event was emitted (see `audit-shape-check.md`).
- The `status` field in stdout is literally `"present_only"`, which clearly
  labels the SQL as not executed.
