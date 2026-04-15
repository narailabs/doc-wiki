# Policy Decision

| Field | Value |
|---|---|
| `policy_gate` | `PRESENT_ONLY` |
| `operation_type` | `DML` (INSERT) |
| `decision` | `present_only` |
| `reason` | DML statements are displayed but not executed |
| `executed` | **false** |
| `env` | `dev` |
| `driver` | `sqlite` |
| `approval_mode` | `auto` |

## Rule that matched

Source: `/Users/narayan/src/doc-wiki/.claude/agents/lib/wiki_db/policy.ts`
(`Policy.checkQuery` → DML branch, lines 226-246):

```ts
// ----- DML: present only (show the SQL, do not execute) -----
if (op === OperationType.DML) {
  let formatted = Policy._stripComments(stripped);
  // Capitalize the first keyword for readability.
  const parts = formatted.split(/\s+/);
  const first = parts[0];
  if (first !== undefined) {
    if (parts.length > 1) {
      const rest = parts.slice(1).join(" ");
      formatted = first.toUpperCase() + " " + rest;
    } else {
      formatted = first.toUpperCase();
    }
  }
  return {
    decision: "present_only",
    reason: "DML statements are displayed but not executed",
    formatted_sql: formatted,
  };
}
```

### Classifier match

`classifySqlKeywords` (same file, lines 84-98) tokenises the SQL, uppercases
the first token, and tests it against the DML keyword set:

```ts
const _DML_KEYWORDS: ReadonlySet<string> = new Set([
  "INSERT", "UPDATE", "DELETE", "REPLACE", "MERGE", "UPSERT",
]);
```

The leading token `INSERT` matches this set, so `OperationType.DML` is
returned, triggering the PRESENT_ONLY branch above.

### CRITICAL RULES citation (AGENT.md)

> - **NEVER execute INSERT, UPDATE, DELETE** — return formatted SQL via PRESENT_ONLY

See `/Users/narayan/src/doc-wiki/.claude/agents/wiki-db-agent/AGENT.md` §"CRITICAL RULES".

## Wire-format result

The CLI entry (`db_query.ts` → `executeQuery`) wraps the
`{decision: "present_only"}` policy result into the agent's public JSON
contract (`query.ts` lines 91-98):

```json
{
  "status": "present_only",
  "reason": "DML statements are displayed but not executed",
  "formatted_sql": "INSERT INTO users (name, email) VALUES ('Test', 'test@example.com')",
  "execution_time_ms": 0.14
}
```

Exit code `0` — PRESENT_ONLY is a successful agent outcome (the SQL was
formatted and returned); it is NOT an error.
