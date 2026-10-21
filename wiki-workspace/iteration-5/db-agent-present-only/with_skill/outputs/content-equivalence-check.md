# Content equivalence check

The presented SQL is semantically equivalent to the requested INSERT:

- Target table: `users` ✓
- Columns listed: `name, email` ✓
- Values: `'Test'` and `'test@example.com'` ✓ (both literal, exact-case match)

Regex evidence from stdout.txt:

```
grep -oE "INSERT INTO users \(name, email\) VALUES \('Test', 'test@example.com'\)" stdout.txt
→ INSERT INTO users (name, email) VALUES ('Test', 'test@example.com')
```
