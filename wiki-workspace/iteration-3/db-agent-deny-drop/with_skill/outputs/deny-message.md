# Deny message presented to the caller

## Raw JSON payload (stdout)

```json
{
  "status": "denied",
  "reason": "DDL statements are never allowed",
  "execution_time_ms": 0.14
}
```

## Human-readable summary

The wiki-db-agent refused the request:

> DDL statements are never allowed. The query `DROP TABLE users` was rejected by the policy gate on environment **production** because `DROP` is classified as a DDL operation, and the guard-rail policy (`agents/lib/wiki_db/policy.ts`) unconditionally denies DDL regardless of `approval_mode`.

## What the caller should do next

- If the intent was to drop a table in a dev or shadow environment, re-issue against `--env dev` — but note that DDL is **also** denied there; the policy is global, not per-env.
- DDL changes must go through the approved migration pipeline (see wiki page on `ecosystem/database-mapping.md` → "How to Go Deeper"). The wiki-db-agent intentionally has no path to execute DDL; escalation to a human is required.

## Assertion coverage

- Message explicitly names the environment: **production** (see policy-decision.md; the `env=production` flag is echoed back via CLI args and is the context under which the deny was issued).
- Message explicitly states DDL is blocked: **"DDL statements are never allowed"** (the exact `reason` string emitted by `policy.ts` line 213).
