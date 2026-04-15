# NOT EXECUTED — Presented SQL (DML PRESENT_ONLY)

- **status:** `present_only`
- **executed:** `false`
- **env:** `dev`
- **driver:** `sqlite`
- **target table:** `users`
- **operation:** `INSERT` (DML)

## Formatted SQL (displayed, not executed)

```sql
INSERT INTO users (name, email) VALUES ('Test', 'test@example.com')
```

## Raw agent output (stdout)

```json
{
  "status": "present_only",
  "reason": "DML statements are displayed but not executed",
  "formatted_sql": "INSERT INTO users (name, email) VALUES ('Test', 'test@example.com')",
  "execution_time_ms": 0.18
}
```

## Verbatim-value check

The formatted SQL contains both required literals verbatim:

- `'Test'` — appears in the `VALUES` clause for the `name` column.
- `'test@example.com'` — appears in the `VALUES` clause for the `email` column.

## Why this was not executed

The guard-rail policy classifier at `.claude/agents/lib/wiki_db/policy.ts` identified
the leading keyword `INSERT` as `OperationType.DML`. The DML branch of
`Policy.checkQuery` never routes to a driver — it returns a `PolicyResult`
with `decision="present_only"` and a human-readable `formatted_sql`
payload. See `policy-decision.md` for the decision record.
