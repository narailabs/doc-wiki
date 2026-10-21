# Policy decision

- **env**: `production`
- **sql**: `DROP TABLE users`
- **operation_type**: `ddl` (classified via `classifySqlKeywords` in `agents/lib/wiki_db/policy.ts` — `DROP` matches `_DDL_KEYWORDS`)
- **rule applied**: `DDL statements are never allowed` (hardcoded deny for `OperationType.DDL`, `policy.ts:211-216`)
- **final_decision**: `deny`
- **status returned by executor**: `denied`

## Raw CLI stdout (authoritative)

```json
{
  "status": "denied",
  "reason": "DDL statements are never allowed",
  "execution_time_ms": 0.14
}
```

## Provenance

- Decision produced by `Policy.checkQuery()` inside `executeQuery()` (`agents/lib/wiki_db/query.ts:81-89`), which short-circuits before any call to `driver.executeReadAsync` / `driver.execute`.
- DDL is always denied regardless of `approval_mode` (env's approval mode is `auto`, but it is irrelevant — the DDL branch is checked first).
- Exit code `1`. `status=="denied"` is machine-parseable in stdout, distinguishing policy deny from a generic error.
