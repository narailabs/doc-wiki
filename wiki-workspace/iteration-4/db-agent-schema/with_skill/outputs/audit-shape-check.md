# Audit Shape Check — `--action schema` against `dev` (sqlite)

R1 verification: `enableAudit(...)` is now wired from
`ecosystem.database.audit.{enabled,path}` inside
`agents/wiki-db-agent/scripts/db_query.ts` (see `resolveEnv`,
lines ~277–291). Because the env-dispatch path runs `enableAudit` before
the connection pool opens, real events land in the configured file.

## Raw audit.jsonl (1 line)

```json
{"event_type":"pool_created","timestamp":"2026-04-14T19:58:04.433Z","session_id":"8693c2f562f9","details":{"env":"dev","driver":"sqlite"}}
```

## `jq -r '.event_type' audit.jsonl`

```
pool_created
```

## Event enumeration

| # | event_type     | operation | executed | notes                                  |
|---|----------------|-----------|----------|----------------------------------------|
| 1 | `pool_created` | n/a       | n/a      | Connection-pool lifecycle (expected).  |

Total events: **1**.

## Assertion verification

- **Write events (`INSERT`/`UPDATE`/`DELETE`)**: `0` — pass.
- **DDL events (`CREATE`/`DROP`/`ALTER`)**: `0` — pass.
- **Privilege events (`GRANT`/`REVOKE`)**: `0` — pass.
- **`executed: true` on any mutation**: `0` — pass.
- **`pool_created`**: present and **expected** — the driver was
  registered and a native SQLite handle was opened to introspect the
  schema. This is a connection lifecycle event, not a data-mutation
  event, and does not violate the read-only contract.

### Why no `schema_inspect` / `query` rows?

The schema action path in `db_query.ts → runSchema()` calls
`driver.getSchema()` directly, which in `SQLiteDriver` reaches for
`PRAGMA table_info(...)` under the `classifyOperation` READ branch. The
policy gate in `wiki_db/policy.ts` is only invoked from the `query`
action (via `executeQuery`), not from schema introspection. Because the
policy gate is the library component that currently emits `policy_eval`
/ `query` audit rows, a pure `--action schema` run emits only the
connection-lifecycle event. This is consistent with the assertion:
"only read-side events" — `pool_created` is a connection event, and no
write/DDL/privilege rows appear.
