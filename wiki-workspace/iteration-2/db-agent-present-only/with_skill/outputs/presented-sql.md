# Presented SQL (NOT EXECUTED)

The wiki-db-agent classified the requested statement as **DML** (INSERT). Per
the guard-rail policy it was **not executed** against the `dev` environment.
The formatted SQL is returned below for the operator to run manually if
desired.

## Formatted statement

```sql
INSERT INTO users (name, email) VALUES ('Test', 'test@example.com')
```

## Agent response (verbatim)

```json
{
  "status": "present_only",
  "reason": "DML statements are displayed but not executed",
  "formatted_sql": "INSERT INTO users (name, email) VALUES ('Test', 'test@example.com')",
  "execution_time_ms": 0.14
}
```

## Execution status

- status: `present_only`
- executed: **no**
- reason: DML statements are never executed by the wiki-db-agent. The
  formatted SQL is presented so the operator can run it manually if the
  intent was correct.

## How to actually run this (if desired)

```bash
sqlite3 /tmp/eval-db-po/dev.sqlite \
  "INSERT INTO users (name, email) VALUES ('Test', 'test@example.com')"
```
