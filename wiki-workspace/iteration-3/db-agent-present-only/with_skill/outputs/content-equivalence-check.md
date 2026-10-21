# Content Equivalence Check (grep proof)

The presented SQL must be semantically equivalent to the user's request:

> "Insert a new user with name 'Test' and email 'test@example.com' into
> the users table on dev"

The three things to prove:
1. `target = users`
2. `values = ('Test', 'test@example.com')`
3. `columns include name AND email`

## Raw output under test

`stdout.txt` (the stdout captured from the agent invocation):

```json
{
  "status": "present_only",
  "reason": "DML statements are displayed but not executed",
  "formatted_sql": "INSERT INTO users (name, email) VALUES ('Test', 'test@example.com')",
  "execution_time_ms": 0.18
}
```

## Grep commands and outputs

### 1. target = users

```
$ grep -nE "INSERT INTO users\b" stdout.txt
4:  "formatted_sql": "INSERT INTO users (name, email) VALUES ('Test', 'test@example.com')",
```

PASS — `INSERT INTO users` appears verbatim.

### 2. columns include name AND email

```
$ grep -nE "\(name, email\)" stdout.txt
4:  "formatted_sql": "INSERT INTO users (name, email) VALUES ('Test', 'test@example.com')",
```

PASS — the column list `(name, email)` appears verbatim and contains
both required column names.

### 3. values = ('Test', 'test@example.com')

```
$ grep -nE "VALUES \('Test', 'test@example\.com'\)" stdout.txt
4:  "formatted_sql": "INSERT INTO users (name, email) VALUES ('Test', 'test@example.com')",
```

PASS — the VALUES tuple `('Test', 'test@example.com')` appears verbatim.

### 4. status labels it as not executed

```
$ grep -nE "\"status\": \"present_only\"" stdout.txt
2:  "status": "present_only",
```

PASS — `status` is literally `present_only`, which is the contract's
"not executed" label.

## Position ordering check

Within a single line, the fields appear in this order:

```
INSERT INTO users (name, email) VALUES ('Test', 'test@example.com')
                   ^^^^  ^^^^^         ^^^^^^  ^^^^^^^^^^^^^^^^^^
                   col1  col2           val1    val2
```

So `name` (column 1) binds to `'Test'` (value 1) and `email` (column 2)
binds to `'test@example.com'` (value 2) — exactly what the prompt
requested.

## Summary

| Claim | Evidence | Verdict |
|---|---|---|
| target table is `users` | `INSERT INTO users` | PASS |
| columns include `name` and `email` | `(name, email)` | PASS |
| values are `'Test'` and `'test@example.com'` | `VALUES ('Test', 'test@example.com')` | PASS |
| presented, not executed | `"status": "present_only"` + row-count-after.txt is 0 | PASS |
