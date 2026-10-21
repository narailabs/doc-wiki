# Presented SQL (NOT EXECUTED)

The wiki-db-agent returned the following SQL verbatim under `status=present_only`. The statement was classified as DML by the policy gate and was **not** run against the database. The agent displays it so a human reviewer can decide whether to promote it through out-of-band approval.

- **Environment:** `dev` (sqlite, `/tmp/eval-i4-db-po/dev.sqlite`)
- **Status:** `present_only`
- **Executed:** false
- **Reason (from policy):** DML statements are displayed but not executed

## Formatted SQL

```sql
INSERT INTO users (name, email) VALUES ('Test', 'test@example.com')
```

## Verbatim-literal check

| Literal | Present in `formatted_sql`? |
|---|---|
| `Test` | yes |
| `test@example.com` | yes |

Both literal values from the user prompt (`name='Test'`, `email='test@example.com'`) appear unchanged in the presented statement.

## Raw agent output (`stdout.txt`)

```json
{
  "status": "present_only",
  "reason": "DML statements are displayed but not executed",
  "formatted_sql": "INSERT INTO users (name, email) VALUES ('Test', 'test@example.com')",
  "execution_time_ms": 0.15
}
```
