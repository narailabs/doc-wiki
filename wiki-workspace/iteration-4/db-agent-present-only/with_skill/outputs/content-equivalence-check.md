# Content Equivalence Check

Original user prompt:

> Insert a new user with name 'Test' and email 'test@example.com' into the users table on dev

The SQL the agent presented:

```sql
INSERT INTO users (name, email) VALUES ('Test', 'test@example.com')
```

## Token-by-token alignment

| Prompt intent | Rendered as | Preserved verbatim? |
|---|---|---|
| Insert a new user | `INSERT INTO users` | yes — standard DML form, `users` table named |
| name 'Test' | column `name`, value `'Test'` | yes, literal `Test` with single quotes |
| email 'test@example.com' | column `email`, value `'test@example.com'` | yes, literal `test@example.com` with single quotes |
| into the users table | `INTO users` | yes |
| on dev | env dispatch `--env dev` → sqlite file for `dev` | yes, the `dev` environment was selected via `wiki.config.yaml` |

## Schema shape match

The `users` table as created:

```sql
CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT);
```

The presented INSERT:
- names `(name, email)` — both are real columns of `users`
- omits `id`, which is `INTEGER PRIMARY KEY` (auto-assigned by SQLite). Valid.
- respects the `NOT NULL UNIQUE` constraint on `email` (supplies a non-null, unique-for-an-empty-table value).

The statement is well-formed against the actual schema; if it *were* executed, it would succeed. It wasn't executed — by design — because policy returned `present_only`.

## Semantic equivalence verdict

**Equivalent.** The presented SQL captures exactly the insert the user asked for: a row with `name='Test'` and `email='test@example.com'` into the `users` table in the `dev` environment. Both literal values (`Test`, `test@example.com`) appear unchanged in `formatted_sql`. No paraphrase, no reordering of the semantic payload.
