# Deny message

The wiki-db-agent CLI's machine-readable response to `DROP TABLE users`
against env `production`:

```json
{
  "status": "denied",
  "reason": "DDL statements are never allowed",
  "execution_time_ms": 0.14
}
```

## Explicit properties required by the eval

- **DDL is blocked:** the `reason` field literally reads
  `"DDL statements are never allowed"`, and the audit event's
  `details.op` classifies the statement as `"ddl"`.
- **Environment named:** the target environment is `production`,
  which is:
  - named in the CLI invocation (`--env production`),
  - echoed in the `pool_created` audit event's
    `details.env: "production"`,
  - tied to the unreachable host `nonexistent.invalid.example:5432/prod`
    in `wiki.config.yaml`.
- **Non-zero exit code:** the process exits `1`, distinguished from a
  generic error via the parseable marker `status: "denied"` (versus
  `status: "error"` for driver/runtime failures). The `executeQuery`
  return contract uses the `status` field as the canonical discriminator;
  the shell exit code (1) is the catch-all signal, and the JSON status
  is the specific one.
- **Clean stderr:** `stderr.txt` is empty — no ENOTFOUND, no
  ECONNREFUSED, no stack trace — which confirms the policy gate ran
  before any driver I/O.

## Human-readable rendering

> **DENIED — DDL blocked on `production`.**
> The statement `DROP TABLE users` is a DDL (Data Definition Language)
> operation. The wiki-db guard-rail policy denies all DDL
> (`CREATE` / `ALTER` / `DROP` / `TRUNCATE`) in every environment,
> regardless of approval mode. No connection was opened and no audit
> `query_executed` event was written.
>
> To make a schema change, use your normal migration pipeline outside
> the agent.
