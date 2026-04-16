# Phase 2 Prompt: Extract DB Agent to Standalone Repo

Paste this into a new Claude Code session:

---

## Task

Extract the wiki-db-agent into a standalone repository (`db-agent/` at the project root, gitignored) that can be distributed as a Claude Code plugin via the plugin marketplace. The standalone agent is a **pure database tool** — no Mermaid diagrams, no wiki-specific formatting. doc-wiki keeps a thin wrapper agent that delegates to the standalone and adds Mermaid on top.

## What was already done (Phase 1 — Source Agent Registry)

A source agent registry was implemented in `.claude/agents/lib/source_registry.ts`. Key changes:
- `AgentManifest` interface with `source_schemes`, `source_url_patterns`, `invocation_template`
- All 10 AGENT.md files now have registry frontmatter (`version`, `source_schemes`, etc.)
- `how_to_go_deeper.ts` was refactored from hardcoded switch statements to registry-driven `lookupBySource()` 
- Custom agents can be registered via `ecosystem.agents.custom` in `wiki.config.yaml`
- All 1058 tests pass. No regressions.

## Phase 2 Plan

### Step 1: Create standalone `db-agent/` repo structure

Create `db-agent/` at the project root (add to `.gitignore`). This is a pure database tool — no Mermaid, no wiki coupling.

**What gets extracted:**

| Source (in doc-wiki) | Destination (standalone) |
|---|---|
| `.claude/agents/lib/wiki_db/policy.ts` | `src/lib/policy.ts` |
| `.claude/agents/lib/wiki_db/query.ts` | `src/lib/query.ts` |
| `.claude/agents/lib/wiki_db/connection.ts` | `src/lib/connection.ts` |
| `.claude/agents/lib/wiki_db/environments.ts` | `src/lib/environments.ts` |
| `.claude/agents/lib/wiki_db/credentials.ts` | `src/lib/credentials.ts` |
| `.claude/agents/lib/wiki_db/audit.ts` | `src/lib/audit.ts` |
| `.claude/agents/lib/wiki_db/schema.ts` | `src/lib/schema.ts` |
| `.claude/agents/lib/wiki_db/index.ts` | `src/lib/index.ts` |
| `.claude/agents/lib/wiki_db/drivers/base.ts` | `src/lib/drivers/base.ts` |
| `.claude/agents/lib/wiki_db/drivers/sqlite.ts` | `src/lib/drivers/sqlite.ts` |
| `.claude/agents/lib/wiki_db/drivers/postgresql.ts` | `src/lib/drivers/postgresql.ts` |
| `.claude/agents/lib/wiki_db/drivers/mysql.ts` | `src/lib/drivers/mysql.ts` |
| `.claude/agents/lib/wiki_db/drivers/sqlserver.ts` | `src/lib/drivers/sqlserver.ts` |
| `.claude/agents/lib/wiki_db/drivers/mongodb.ts` | `src/lib/drivers/mongodb.ts` |
| `.claude/agents/lib/wiki_db/drivers/dynamodb.ts` | `src/lib/drivers/dynamodb.ts` |
| `.claude/agents/lib/wiki_db/drivers/register.ts` | `src/lib/drivers/register.ts` |
| `.claude/agents/lib/wiki_db/drivers/external-modules.d.ts` | `src/lib/drivers/external-modules.d.ts` |
| `.claude/agents/lib/credential_providers/*.ts` | `src/lib/credential_providers/*.ts` |
| `.claude/agents/lib/parse_config.ts` | `src/lib/parse_config.ts` |
| `.claude/agents/wiki-db-agent/scripts/db_query.ts` (query+schema parts, WITHOUT mermaid) | `src/cli.ts` |
| `.claude/agents/lib/wiki_db/tests/*.test.ts` | `tests/*.test.ts` |
| `.claude/agents/lib/wiki_db/tests/fixtures.ts` | `tests/fixtures.ts` |
| `.claude/agents/lib/wiki_db/drivers/test_drivers/*.test.ts` | `tests/drivers/*.test.ts` |
| `.claude/agents/lib/credential_providers/tests/*.test.ts` | `tests/credential_providers/*.test.ts` |
| `.claude/agents/wiki-db-agent/scripts/tests/*.test.ts` | `tests/cli*.test.ts` |
| `.claude/agents/wiki-db-agent/evals/` | `evals/` |

**What does NOT get extracted:**

| File | Reason |
|---|---|
| `.claude/agents/lib/mermaid_format.ts` | Wiki-specific — stays in doc-wiki, used by the wrapper |
| `.claude/agents/wiki-db-agent/AGENT.md` | Becomes the wrapper agent definition |
| `.claude/agents/lib/_agent_cli.ts` | Not used by wiki_db |
| `.claude/agents/lib/security_check.ts` | Not used by wiki_db |
| `.claude/agents/lib/fetch_helper.ts` | Not used by wiki_db |

**Standalone repo layout:**

```
db-agent/
  AGENT.md                    # Plugin manifest (pure DB capabilities)
  package.json                # @doc-wiki/db-agent
  tsconfig.json
  vitest.config.ts
  src/
    index.ts                  # Public API re-exports
    cli.ts                    # CLI entry point (no mermaid)
    lib/                      # (all wiki_db modules with adjusted imports)
      policy.ts, query.ts, connection.ts, environments.ts,
      credentials.ts, audit.ts, schema.ts, index.ts
      drivers/
        base.ts, sqlite.ts, postgresql.ts, mysql.ts,
        sqlserver.ts, mongodb.ts, dynamodb.ts, register.ts
      credential_providers/
        index.ts, env_var.ts, file.ts, keychain.ts, cloud_secrets.ts
  tests/
    (mirrors doc-wiki test structure)
```

**Import path changes:** All current imports use relative paths like `../../lib/wiki_db/policy.js`. In the standalone repo, these become `./lib/policy.js` or `../lib/policy.js` depending on depth. No `../../` escaping needed.

### Step 2: Create the standalone AGENT.md

```yaml
---
name: db-agent
description: |
  Safe, read-only database query agent with guard-rail policy enforcement.
  Pure database tool — no wiki-specific formatting.
  Supports PostgreSQL, MySQL, SQLite, SQL Server, MongoDB, DynamoDB via
  pluggable drivers. All queries go through the policy gate first.
type: database
autonomy_level: supervised
model: haiku
tools: [Bash, Read, Write]
version: "1.0.0"
source_schemes: ["db://"]
invocation_template:
  subagent_type: db-agent
  default_model: haiku
  label: Database
---
```

### Step 3: Create package.json for standalone

```json
{
  "name": "@doc-wiki/db-agent",
  "version": "1.0.0",
  "type": "module",
  "engines": { "node": ">=20.0.0" },
  "exports": {
    ".": "./dist/lib/index.js",
    "./cli": "./dist/cli.js",
    "./policy": "./dist/lib/policy.js"
  },
  "bin": { "wiki-db-query": "./dist/cli.js" },
  "scripts": {
    "build": "tsc -b",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "better-sqlite3": "^12.9.0",
    "js-yaml": "^4.1.1"
  },
  "optionalDependencies": {
    "pg": "^8.20.0",
    "mysql2": "^3.22.0",
    "mssql": "^12.2.1",
    "mongodb": "^7.1.1",
    "@aws-sdk/client-dynamodb": "^3.1030.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.14",
    "@types/js-yaml": "^4.0.9",
    "@types/node": "^20.19.39",
    "@types/pg": "^8.15.6",
    "typescript": "^5.9.3",
    "vitest": "^3.0.0"
  }
}
```

### Step 4: Strip mermaid from the CLI

The current `db_query.ts` imports `formatErDiagram` from `mermaid_format.ts` and adds a `mermaid` field to schema results. In the standalone `cli.ts`, remove this — return raw `{tables, table_count}` without `mermaid`. The wrapper in doc-wiki adds it back.

### Step 5: Create wrapper `db_wrapper.ts` in doc-wiki

**New file:** `.claude/agents/wiki-db-agent/scripts/db_wrapper.ts`

This wrapper:
1. Tries to import `@doc-wiki/db-agent`
2. If missing, runs `npm install @doc-wiki/db-agent` to auto-install
3. Delegates the query/schema call to the standalone agent
4. For schema results, generates Mermaid ER diagram using `mermaid_format.ts` (which stays in doc-wiki)
5. Returns the combined result (data + mermaid) matching the existing output contract

### Step 6: Refactor ORM cross-validation to dependency injection

**File:** `.claude/agents/lib/wiki_orm/extractor.ts` (line 20)

Currently:
```typescript
import { getConnection, releaseConnection, SchemaManager, type Table } from "../wiki_db/index.js";
```

Change `crossValidate()` to accept an injected db provider:
```typescript
export interface DbProvider {
  getConnection: (envName: string) => Promise<{ envName: string; native: unknown; driver: unknown }>;
  releaseConnection: (envName: string, conn: unknown) => void;
  SchemaManager: { new(): { getSchema(driver: unknown, conn: unknown, schema?: string, filter?: string | null): Table[] } };
}

export async function crossValidate(
  entities: ExtractedEntity[],
  envName: string,
  dbProvider?: DbProvider,
): Promise<CrossValidationReport> {
  if (!dbProvider) {
    return { error: "Database agent not available for cross-validation", ... };
  }
  // ... use dbProvider instead of direct import
}
```

The top-level import from `wiki_db` becomes a dynamic import or is removed entirely. Callers (the ORM agent CLI, tests) inject the provider when available.

### Step 7: Verify

1. In `db-agent/`: `npm install && npm run build && npm test` — all wiki_db + driver + credential tests pass
2. In doc-wiki: `npm test` — all 1058 existing tests still pass (the wrapper delegates correctly, ORM cross-validation works via injection)
3. The standalone CLI works: `node db-agent/dist/cli.js --sqlite :memory: --sql "SELECT 1"`

## Key architecture decisions

- **Mermaid stays in doc-wiki.** The standalone db-agent returns raw schema data. The wrapper adds `mermaid_format.ts` diagram generation.
- **Auto-install.** The wrapper tries to import `@doc-wiki/db-agent` and installs it if missing — zero manual setup.
- **Dependency injection for ORM.** The `extractor.ts` cross-validation no longer has a hard import on wiki_db. It accepts an optional `DbProvider` interface.
- **The source_registry discovers both.** The standalone agent's AGENT.md and doc-wiki's wrapper AGENT.md are both discoverable. The wrapper takes precedence (it's in `.claude/agents/`, the builtin path).

## NPM dependencies needed by wiki_db

Check the root `package.json` for exact versions:
- `better-sqlite3`, `pg`, `mysql2`, `mssql`, `mongodb`, `@aws-sdk/client-dynamodb`
- `js-yaml` (for parse_config)
- `@types/better-sqlite3`, `@types/js-yaml`, `@types/node`, `@types/pg`
- `vitest` (dev)
- `typescript` (dev)
