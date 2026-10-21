# Policy Decision

- **policy_gate:** `PRESENT_ONLY`
- **wire status:** `present_only`
- **reason:** `DML statements are displayed but not executed`
- **approval_mode:** `auto` (inherited from `wiki.config.yaml → ecosystem.database.environments.dev.approval_mode`)
- **executed:** false

## Rule citation

The matching rule is the DML branch of `Policy.checkQuery` in `agents/lib/wiki_db/policy.ts` (lines 225-246 at commit `d208468`):

```ts
// ----- DML: present only (show the SQL, do not execute) -----
if (op === OperationType.DML) {
  let formatted = Policy._stripComments(stripped);
  ...
  return {
    decision: "present_only",
    reason: "DML statements are displayed but not executed",
    formatted_sql: formatted,
  };
}
```

The classifier `classifySqlKeywords(sql)` matched the statement because its leading keyword `INSERT` is in `_DML_KEYWORDS`:

```ts
const _DML_KEYWORDS: ReadonlySet<string> = new Set([
  "INSERT", "UPDATE", "DELETE", "REPLACE", "MERGE", "UPSERT",
]);
```

## Why the decision is PRESENT_ONLY and not ALLOW / DENY

| Category | What happens | Why this statement doesn't hit it |
|---|---|---|
| READ (SELECT/EXPLAIN/SHOW/…) | allow / escalate / grant-check | first token is `INSERT`, not read |
| DML (INSERT/UPDATE/DELETE/REPLACE/MERGE/UPSERT) | **present_only** — displayed, never executed | **this branch** |
| DDL (CREATE/DROP/ALTER/TRUNCATE/RENAME) | always denied | first token isn't DDL |
| PRIVILEGE (GRANT/REVOKE) | always denied | first token isn't privilege |

The guard-rail policy therefore returns `present_only` before the driver is ever asked to execute anything. The `executeQuery` wrapper in `agents/lib/wiki_db/query.ts` short-circuits on `decision === "present_only"` and reports `status=present_only` without calling the driver's `execute` path.

## Evidence of the short-circuit

- `stdout.txt` → `"status": "present_only"`
- `row-count-before.txt` → `0`
- `row-count-after.txt` → `0` (no row inserted; the driver was never invoked for the INSERT)
