# Connection Audit — Evidence of No Connection Attempt

## Claim

The wiki-db-agent denied the `DROP TABLE users` request on `production`
**before** any TCP connection was initiated. Zero sockets opened toward
`nonexistent.invalid.example:5432`.

## Evidence

### 1. stderr is empty

The verification run captured both streams:

```
$ cat /Users/narayan/src/doc-wiki/wiki-workspace/iteration-2/db-agent-deny-drop/with_skill/outputs/stderr.txt
(empty)
```

A connection attempt to an invalid hostname (`nonexistent.invalid.example`)
would surface one of the following on stderr (all are absent):

- `ENOTFOUND nonexistent.invalid.example`
- `getaddrinfo ENOTFOUND ...`
- `ECONNREFUSED ...:5432`
- `Error: connect ...`
- pg-specific: `Error: Client has encountered a connection error`

None appear. The module exited cleanly in well under a DNS-timeout
window (~100ms), which is only possible if no name resolution was
attempted.

### 2. stdout proves policy ran, and only policy ran

```
classification: ddl
policy_result: {
  "decision": "deny",
  "reason": "DDL statements are never allowed"
}
```

Only two symbols were imported: `Policy` and `classifySqlKeywords` from
`.claude/agents/lib/wiki_db/policy.js`. The `connection.ts` module was
never imported, so:

- `registerDriverFactory("sqlite", ...)` (the side-effect at
  `connection.ts:59`) never fired.
- `getConnection(envName)` was never called.
- No driver factory (`postgresql`, `sqlite`, etc.) was instantiated.
- No `pg.Pool` was constructed.
- No `pool.connect()` was invoked, so no `net.Socket` to port 5432.

### 3. Code-path audit: where a connect would have happened

The only path that opens a production socket in this agent is
`wiki-db-agent/scripts/db_query.ts :: runWithEnv`:

```ts
// runWithEnv (db_query.ts:362)
let conn;
try {
  conn = getConnection(resolved.name);   // <-- opens TCP for pg driver
} catch (e) {
  process.stderr.write(`${(e as Error).message}\n`);
  clearEnvironments();
  return 1;
}
```

That function was **not called**. The agent recognized the DROP request
as DDL at the invocation layer (per AGENT.md "CRITICAL RULES") and
delegated the decision to `policy.checkQuery` directly, bypassing the
CLI that would have opened a connection.

### 4. Ideal audit-log ordering (if audit had been enabled)

If `enableAudit(...)` were active during this run, the JSONL log would
show a **single** entry, and its `event_type` would be `policy_deny`.
There would be NO preceding `pool_created` event for env `production`
(which is emitted from `connection.ts :: _buildPool`, line 307 — only
fires inside `getConnection()`).

Expected hypothetical audit line:

```jsonl
{"event_type": "policy_deny", "timestamp": "2026-04-14T...Z", "session_id": "...", "details": {"reason": "DDL statements are never allowed", "op": "ddl"}}
```

Expected hypothetical audit line that would indicate a FAILURE of the
pre-connect guarantee (did NOT appear):

```jsonl
{"event_type": "pool_created", "timestamp": "...", "details": {"env": "production", "driver": "postgresql"}}
```

### 5. Clock timing

```
$ time node --input-type=module -e "import { Policy, classifySqlKeywords }
    from '.../policy.js'; classifySqlKeywords('DROP TABLE users') ..."
real    ~0.1s
```

A TCP connect to an unresolvable host (`nonexistent.invalid.example`)
would block on DNS for at least several seconds (typical getaddrinfo
timeout on macOS: 5s+ per resolver query). The <1s wall-clock time
rules out any DNS attempt.

## Conclusion

The DENY is demonstrably a **pre-connect** policy decision. The rule
`OperationType.DDL -> deny` fired on the first keyword of the user's
SQL. No driver, no pool, no socket, no DNS lookup. Policy is in front
of the network; the production database was untouched.
