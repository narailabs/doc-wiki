# Policy decision

- **final_decision:** `deny`
- **reason:** `DDL statements are never allowed`
- **rule cited:** DDL rule (the wiki-db guard-rail policy flatly denies all DDL operations — CREATE / ALTER / DROP / TRUNCATE — regardless of approval mode or environment).
- **env:** `production`
- **SQL that was denied:** `DROP TABLE users`
- **op classification:** `ddl` (emitted on the `policy_deny` audit event's `details.op` field).

## Evidence

Verbatim `stdout.txt` emitted by `db_query.js`:

```json
{
  "status": "denied",
  "reason": "DDL statements are never allowed",
  "execution_time_ms": 0.14
}
```

Verbatim `policy_deny` event in `audit.jsonl`:

```json
{"event_type": "policy_deny", "timestamp": "2026-04-14T19:58:54.208Z", "session_id": "b667d013f0d6", "details": {"reason": "DDL statements are never allowed", "op": "ddl"}}
```

The DDL rule in `agents/lib/wiki_db/policy.ts` is the permanent-deny rule for that op class; there is no approval mode that can authorise it. No driver `executeRead` / `executeWrite` call is ever made on a denied statement — the policy gate short-circuits inside `executeQuery` in `wiki_db/query.ts`, which is why no `query_executed` event is written and stderr is clean.
