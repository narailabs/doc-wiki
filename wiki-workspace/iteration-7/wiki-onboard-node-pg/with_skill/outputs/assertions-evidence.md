# Assertions Evidence — wiki-onboard-node-pg (eval_id 13)

## Assertion 1
**Text:** wiki.config.yaml has language: javascript (or nodejs) inferred from package.json

**Evidence:**

From `wiki-config.yaml` (line 7):
```yaml
ecosystem:
  language: javascript
  framework: express
```

Detection source: `package.json` present at `/tmp/eval-i7-onboard-node-pg/package.json`. The presence of `package.json` is the SKILL.md marker for "Node.js / TypeScript". Dependencies include `express`, `pg`, `dotenv` — all JavaScript/Node ecosystem packages. Language detected as `javascript`.

Detection trace entry:
```json
{"phase": "language", "marker_file": "package.json", "found": true, "detected": "javascript"}
```

**Status:** EVIDENCE PRESENT

---

## Assertion 2
**Text:** framework: express is set when express is in package.json dependencies; alternatively, framework: null (or absent) is acceptable ONLY if a detection-trace entry explicitly notes 'express detected but not configured as framework' — silent omission is a failure

**Evidence:**

From `wiki-config.yaml` (line 8):
```yaml
ecosystem:
  language: javascript
  framework: express
```

`express` is in `package.json#dependencies` at version `^4.18.0`. It was detected and written as `framework: express`.

Detection trace entry:
```json
{"phase": "framework", "key": "express", "found_in": "package.json#dependencies", "detected": "express", "version_range": "^4.18.0"}
```

**Status:** EVIDENCE PRESENT

---

## Assertion 3
**Text:** ecosystem.database.driver: postgresql is set; host: db.local, port: 5432, database: appdb parsed from the connection string in src/db.js

**Evidence:**

From `wiki-config.yaml` (lines 12–18):
```yaml
  database:
    enabled: true
    driver: postgresql
    host: db.local
    port: 5432
    database: appdb
    user_secret: WIKI_DB_DEV_USER
```

Connection string `postgres://wikiuser@db.local:5432/appdb` was found in the comment in `src/db.js`:
```js
// DATABASE_URL=postgres://wikiuser@db.local:5432/appdb
```

And confirmed in `.env.example`:
```
DATABASE_URL=postgres://wikiuser@db.local:5432/appdb
```

Parsed values:
- driver: `postgresql` (from `postgres://` scheme)
- host: `db.local`
- port: `5432`
- database: `appdb`

Detection trace entry:
```json
{"phase": "database", "source_file": "src/db.js", "detected_driver": "postgresql", "parsed_host": "db.local", "parsed_port": 5432, "parsed_database": "appdb"}
```

**Status:** EVIDENCE PRESENT

---

## Assertion 4
**Text:** Credentials are referenced by secret name (user_secret: WIKI_DB_DEV_USER or similar) — no plaintext password OR username appears in wiki.config.yaml

**Evidence:**

From `wiki-config.yaml` line 18:
```yaml
    user_secret: WIKI_DB_DEV_USER
```

Secret scan result:
```
grep -E "(password|passwd|wikiuser|secret\s*=\s*['\"]|user\s*=\s*['\"])" wiki.config.yaml
→ NO MATCHES
```

The username `wikiuser` from the connection string was NOT written to the config. No `password:` field exists in the config. Only the secret reference key name `WIKI_DB_DEV_USER` is stored.

See `secret-scan.md` for full scan details.

**Status:** EVIDENCE PRESENT

---

## Assertion 5
**Text:** ecosystem.orm.profiles is either an empty list [] OR contains exactly ['raw_sql'] — none of the shipped ORM profile names (jpa, sqlalchemy, django, prisma, typeorm, activerecord, entity_framework) appear, since the fixture has no ORM library

**Evidence:**

From `wiki-config.yaml`:
```yaml
  orm:
    enabled: true
    profiles: []
    custom_profiles: []
    cross_validate_against_db: true
```

From `orm-detection.json`:
```json
{
  "status": "success",
  "orm_detected": null,
  "entities": [],
  "mapping_file": null,
  "mermaid": null
}
```

`orm_detect.js` ran in auto-detect mode against the fixture. It checked all 7 shipped profiles and found zero matches (`orm_detected: null`, `entities: []`). The config reflects this with `profiles: []`.

See `orm-profile-check.md` for per-profile breakdown.

**Status:** EVIDENCE PRESENT

---

## Assertion 6
**Text:** Policy stanza (block_ddl, block_privilege, dml_mode, audit.enabled) is populated under the database section with safe defaults (block_ddl: true, block_privilege: true, dml_mode: 'escalate' or 'deny', audit.enabled: true)

**Evidence:**

From `wiki-config.yaml` (lines 19–27):
```yaml
    policy:
      block_ddl: true
      block_privilege: true
      dml_mode: escalate
      escalate_unbounded_reads: true
      audit:
        enabled: true
        path: audit/db.jsonl
    audit:
      enabled: true
      path: audit/db.jsonl
```

All required fields present:
- `block_ddl: true` — DDL statements blocked
- `block_privilege: true` — privilege operations blocked
- `dml_mode: escalate` — DML requires escalation (safe default per assertion)
- `audit.enabled: true` — audit logging on

**Status:** EVIDENCE PRESENT

---

## Assertion 7
**Text:** Wiki scaffold (wiki/, raw/, graph/, audit/, log/, outputs/) exists at the configured wiki_root after onboard completes (auto-init triggered)

**Evidence:**

`init_wiki.js` created the scaffold. All 6 required directories confirmed:

| Directory | Confirmed |
|-----------|-----------|
| wiki/     | YES — contains index.md, summaries.md, overview.md, claims/, synthesis/, templates/ |
| raw/      | YES — present (empty, no ingests yet) |
| graph/    | YES — contains edges.jsonl |
| audit/    | YES — contains open/ and resolved/ subdirs |
| log/      | YES — contains daily/, events.jsonl, detection-trace.jsonl |
| outputs/  | YES — contains queries/ and reports/ subdirs |

init_wiki.js stdout:
```json
{"status": "ok", "created_dirs": ["wiki", "wiki/claims", "wiki/synthesis", "wiki/templates", "raw", "graph", "audit/open", "audit/resolved", "log/daily", "outputs/queries", "outputs/reports", ".wiki-cache"]}
```

See `scaffold-check.md` for full `ls` output.

**Status:** EVIDENCE PRESENT

---

## Assertion 8
**Text:** events.jsonl contains one op='init' event AND one op='onboard' event (or equivalent), each with ISO timestamps

**Evidence:**

From `events.jsonl` (3 lines total):

```
Line 1: {"ts": "2026-04-15T01:01:31.210000+00:00", "op": "init", "domain": "onboard-node-pg", ...}
Line 2: {"ts": "2026-04-15T01:02:00.379000+00:00", "op": "init", "project_root": "/tmp/eval-i7-onboard-node-pg", "scaffold_created": true}
Line 3: {"ts": "2026-04-15T01:02:04.467000+00:00", "op": "onboard", "language": "javascript", "framework": "express", "database_driver": "postgresql", ...}
```

- op=`init` events: 2 (lines 1 and 2) — line 1 from init_wiki.js's own internal log, line 2 from explicit event_logger.js call
- op=`onboard` event: 1 (line 3) — logged via event_logger.js with full onboard context
- All timestamps are ISO 8601 format with UTC offset `+00:00`, e.g. `2026-04-15T01:02:04.467000+00:00`

Assertion requires "one op=init AND one op=onboard" — both are present.

**Status:** EVIDENCE PRESENT

---

## Summary

| # | Assertion | Evidence |
|---|-----------|----------|
| 1 | language: javascript from package.json | PRESENT |
| 2 | framework: express from dependencies | PRESENT |
| 3 | postgresql driver + host/port/db parsed from connection string | PRESENT |
| 4 | No plaintext credentials — secret ref only | PRESENT |
| 5 | orm.profiles: [] — no ORM library detected | PRESENT |
| 6 | Policy stanza: block_ddl/block_privilege/dml_mode/audit populated | PRESENT |
| 7 | Wiki scaffold (wiki/raw/graph/audit/log/outputs/) all exist | PRESENT |
| 8 | events.jsonl has init + onboard events with ISO timestamps | PRESENT |

All 8 assertions have supporting evidence in the collected artifacts.
