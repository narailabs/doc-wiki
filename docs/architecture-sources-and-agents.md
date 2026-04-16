# Sources & Agents Architecture

How the doc-wiki discovers, fetches, and compiles knowledge from external platforms, databases, and codebases into wiki pages.

---

## 1. Overview: What Are Sources and Agents?

The doc-wiki system turns raw information into structured wiki pages. Two concepts are central:

- **Sources** are where information lives: a GitHub repo, a Confluence space, a PostgreSQL database, ORM entity classes in your codebase, a Jira project, a Notion workspace, or cloud infrastructure on AWS/GCP.

- **Agents** are the workers that fetch and normalize information from those sources. Each agent is a self-contained unit that knows how to talk to one platform, extract structured data, and return it in a standard JSON envelope.

The **wiki skill** (`.claude/skills/wiki/SKILL.md`) orchestrates everything. It reads the project's `wiki.config.yaml` to know which agents are enabled, dispatches them in parallel during ingestion, collects their responses, and compiles the results into wiki pages.

```
User runs /wiki-ingest
       |
       v
  Wiki Skill (orchestrator)
       |
       +-- reads wiki.config.yaml
       |
       +-- dispatches enabled agents in parallel via Agent() tool
       |       |
       |       +-- wiki-github-agent   --> GitHub REST API
       |       +-- wiki-jira-agent     --> Jira REST API
       |       +-- wiki-confluence-agent --> Confluence REST API
       |       +-- wiki-notion-agent   --> Notion API
       |       +-- wiki-db-agent       --> Live database
       |       +-- wiki-orm-agent      --> Codebase ORM patterns
       |       +-- wiki-aws-agent      --> AWS metadata
       |       +-- wiki-gcp-agent      --> GCP metadata
       |
       +-- collects JSON responses
       |
       +-- compiles wiki page(s) with Mermaid diagrams
       |
       +-- runs post-op hooks (crosslink, tag-harmonize)
```

There is no standalone CLI. All orchestration runs inside Claude Code's session -- the skill dispatches agents using Claude Code's `Agent()` tool, and TypeScript scripts handle deterministic operations (hashing, parsing, graph ops, lint).

---

## 2. The Agent Plugin Model

### 2.1 How an Agent Is Defined

Every agent lives in its own directory under `.claude/agents/` and is defined by an `AGENT.md` file with YAML frontmatter:

```yaml
---
name: wiki-github-agent
description: |
  Fetches repository metadata, code, issues, and pull requests from GitHub
  via REST API. Read-only -- never creates or modifies GitHub data.
type: source            # "source" for fetchers, "mapper" for codebase analyzers,
                        # "database" for DB introspection
autonomy_level: supervised   # supervised = needs human approval for risky ops
                             # autonomous = can act freely within its scope
model: haiku            # which Claude model runs the agent
tools: [Bash, Read]     # tools the agent is allowed to use
color: green            # UI color hint
---
```

The body of `AGENT.md` defines:
- **Invocation contract** -- what JSON input the agent expects (`action`, `params`)
- **Output contract** -- what JSON the agent returns (`status`, `data`, `mermaid`)
- **Execution phases** -- the steps the agent follows
- **Error codes** -- what can go wrong and how to recover
- **Critical rules** -- invariants the agent must never violate (e.g., "read-only")

### 2.2 Agent Directory Structure

```
.claude/agents/
  wiki-github-agent/
    AGENT.md               # Agent definition (frontmatter + instructions)
    scripts/
      github_fetch.ts      # TypeScript CLI entry point
      lib/
        github_client.ts   # Platform API client
      tests/
        github_fetch.test.ts
    evals/                 # Evaluation test cases
```

### 2.3 Agent Categories

| Category | Agents | Purpose |
|----------|--------|---------|
| **Source** (6) | github, jira, confluence, notion, aws, gcp | Fetch data from external platforms |
| **Mapper** (1) | orm | Analyze codebase patterns (ORM entities) |
| **Database** (1) | db | Introspect live database schemas |
| **Maintenance** (2) | claude-md, mermaid | Generate derived artifacts from wiki content |

### 2.4 How Agents Are Dispatched

The wiki skill dispatches agents via Claude Code's `Agent()` tool:

```
Agent(
  subagent_type = "wiki-github-agent",
  model = "haiku",
  prompt = '{"action": "repo_info", "params": {"owner": "acme", "repo": "backend"}}'
)
```

Key properties of agent dispatch:
- **Parallel execution** -- multiple agents are dispatched simultaneously during ingest
- **Model selection** -- each agent specifies its model in frontmatter; source agents use `haiku` (fast, cheap), the ORM mapper uses `sonnet` (more capable for code analysis)
- **Isolation** -- each agent runs in its own context with only the tools listed in its `tools:` frontmatter

### 2.5 The Standard Output Envelope

Every agent returns JSON matching this contract:

```json
{
  "status": "success",
  "action": "repo_info",
  "data": {
    "full_name": "acme/backend",
    "description": "Backend API service",
    "language": "Python"
  },
  "mermaid": {
    "type": "pie",
    "title": "Language Distribution",
    "code": "pie title Languages\n    \"Python\" : 72\n    \"Shell\" : 15"
  },
  "truncated": false
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `status` | Yes | `"success"`, `"error"`, `"denied"`, or `"present_only"` |
| `action` | Yes | Echoes the invoked action name |
| `data` | Yes | Action-specific structured result |
| `mermaid` | No | Optional diagram (type + title + Mermaid source code) |
| `truncated` | Yes | Whether the result was capped |
| `error_code` | On error | Machine-readable error identifier |
| `message` | On error | Human-readable error description |

The wiki skill collects these envelopes, extracts `mermaid` blocks, and splices them into the compiled wiki page via `mermaid_inject.js` (idempotent -- uses `<!-- wiki-mermaid: title start/end -->` markers so re-ingesting replaces stale diagrams rather than stacking duplicates).

---

## 3. The Onboarding Pipeline (`/wiki-onboard`)

Onboarding is the bridge between "I have a codebase" and "the wiki knows what agents to use." It runs as a 6-phase interactive Q&A, detecting the ecosystem and writing agent configuration into `wiki.config.yaml`.

### Phase 1 -- Auto-detect Language/Framework

The skill scans the project root for build files:

| Marker File | Detection |
|-------------|-----------|
| `pom.xml`, `build.gradle` | Java (Maven/Gradle) |
| `requirements.txt`, `pyproject.toml` | Python |
| `package.json` | Node.js / TypeScript |
| `Gemfile` | Ruby |
| `*.csproj`, `*.sln` | .NET / C# |
| `go.mod` | Go |
| `Cargo.toml` | Rust |

Presents findings and asks the user to confirm.

### Phase 2 -- Detect ORM

Dispatches the **wiki-orm-agent** to scan for entity definitions matching the 7 shipped ORM profiles (JPA, SQLAlchemy, Django, Prisma, TypeORM, Entity Framework, ActiveRecord). The agent walks the codebase, matches detection markers against file contents, extracts entity classes, and reports back:

```
"Detected JPA ORM profile with 23 entity classes"
```

The user confirms. The detected profile is saved to `ecosystem.orm.profiles` in the config.

### Phase 3 -- Detect Database

Dispatches the **wiki-db-agent** to detect the database engine from:
- Docker Compose service images (`postgres:`, `mysql:`, `mongo:`)
- Connection strings in config files (`.env`, `application.properties`, `database.yml`)
- ORM configuration (`DATABASES` in Django, `spring.datasource.url` in Spring Boot)

Presents detected database(s) with redacted credentials. The user confirms. Saved to `ecosystem.database` in the config.

### Phase 4 -- External Services Q&A

Asks the user about each integration:

1. "Do you use **Jira**? If so, what project key(s)?"
2. "Do you use **Confluence**? What space key(s)?"
3. "Do you use **GCP** (BigQuery, Cloud SQL, Pub/Sub)?"
4. "Do you use **AWS** (RDS, DynamoDB, S3)?"
5. "Do you use **Notion**?"
6. "Do you use **GitHub** wikis, discussions, or project boards?"

Each "yes" enables the corresponding source agent in `ecosystem.agents.source`.

### Phase 5 -- Choose Autonomy Mode

| Mode | Behavior |
|------|----------|
| `conservative` | Ask before every write |
| `balanced` (default) | Auto-fix safe changes, ask for structural |
| `autonomous` | Auto-fix everything, notify after |
| `auto` | Choose per-operation based on risk score |

### Phase 6 -- Install Hooks + Scaffold

- Offers to install Claude Code PreToolUse hooks
- Asks about multimodal dependencies (`faster-whisper`, `yt-dlp`)
- Generates/updates `wiki.config.yaml` with all detected settings
- Runs `/wiki-init` if the wiki scaffold doesn't exist

**Output:** A fully configured `wiki.config.yaml` with language, framework, ORM profile, database driver, enabled source agents, and autonomy mode.

---

## 4. The Ingest Pipeline (`/wiki-ingest`)

The 13-step pipeline that turns source material into wiki pages:

```
Source (file, URL, folder, text)
  |
  v
1. Parse wiki.config.yaml
  |
2. Check content-hash cache (skip if unchanged)
  |
3. Extract binary content (PDF, DOCX, PPTX) or multimodal (images, audio, video)
  |
4. Security check (URL validation for remote sources)
  |
5. Read source fully
  |
6. Surface 3-5 takeaways + entity list (LLM reasoning)
  |
7. Dispatch enabled agents in parallel  <--- AGENT DISPATCH HAPPENS HERE
  |       |
  |       +-- Each agent fetches from its platform
  |       +-- Returns JSON with data + optional Mermaid diagram
  |
8. Compile into wiki page(s) (frontmatter, links, code locality, claims)
  |
9. Splice Mermaid diagrams into page (idempotent via markers)
  |
10. Generate "How to Go Deeper" section (agent commands for each source)
  |
11. Rebuild summaries.md index
  |
12. Log event to events.jsonl (includes per-agent cost metrics)
  |
13. Run post-op hooks (crosslink + tag-harmonize)
```

Step 7 is where the source connection happens. The skill reads `ecosystem.agents.source` from `wiki.config.yaml`, dispatches all enabled agents simultaneously, and collects their JSON responses. Each agent independently talks to its platform and returns structured data.

Step 10 is where "How to Go Deeper" bullets are generated -- `how_to_go_deeper.js` classifies each source in the page's `sources:` frontmatter and emits the exact agent command to run for further exploration:
- Jira URL --> `wiki agent jira --query "key = PROJ-123"`
- GitHub URL --> `wiki agent github --path "src/auth/service.py"`
- `db://dev/users` --> `wiki agent db-query dev "DESCRIBE users"`

---

## 5. Database Agent Deep-Dive

The database agent (`wiki-db-agent`) is the most safety-critical agent. It queries live databases but enforces strict guard-rails to prevent any mutation.

### 5.1 Architecture Overview

```
wiki.config.yaml
  |
  v
Environment Config          Driver Registry
  (host, port, driver,       (postgresql, mysql, sqlite,
   approval_mode)              sqlserver, mongodb, dynamodb)
  |                           |
  v                           v
Connection Pool Manager  <--- Driver Factory
  |                           |
  v                           v
Policy Gate -----+-----> Database Driver
  |              |            |
  ALLOW -------->|------> executeReadAsync()
  DENY -------->|            |
  ESCALATE ---->|            v
  PRESENT_ONLY->|        Structured Result
                |            |
                v            v
            Audit Trail   JSON Output
```

### 5.2 The Policy Guard-Rail System

Every query passes through the `Policy` class (`.claude/agents/lib/wiki_db/policy.ts`) before touching the database. The policy classifies SQL by its leading keyword and returns one of four decisions:

| Decision | When | Effect |
|----------|------|--------|
| **ALLOW** | SELECT, EXPLAIN, SHOW, DESCRIBE, WITH (bounded) | Query executes normally |
| **DENY** | CREATE, DROP, ALTER, TRUNCATE, GRANT, REVOKE | Hard block. Never executed. |
| **ESCALATE** | Unbounded SELECT (no WHERE/LIMIT/JOIN/GROUP BY) | Needs human approval first |
| **PRESENT_ONLY** | INSERT, UPDATE, DELETE, REPLACE, MERGE, UPSERT | SQL is formatted and displayed, but never executed |

**SQL classification flow:**

```
Input SQL
  |
  v
Strip comments (-- and /* */)
  |
  v
Extract first keyword
  |
  +-- GRANT, REVOKE          --> PRIVILEGE --> DENY (always)
  +-- CREATE, DROP, ALTER...  --> DDL       --> DENY (always)
  +-- INSERT, UPDATE, DELETE  --> DML       --> PRESENT_ONLY (always)
  +-- SELECT, EXPLAIN, SHOW  --> READ      --> depends on approval mode
  +-- Unknown keyword         --> DDL       --> DENY (default-deny)
```

**Non-SQL drivers** (MongoDB, DynamoDB) override `classifyOperation()` in their driver class to map their own verbs: MongoDB `find` --> READ, `insertOne` --> DML; DynamoDB `scan` --> READ, `putItem` --> DML. The policy gate handles them identically after classification.

**Unbounded query detection:** For READ operations, an additional heuristic checks whether a SELECT has a bounding clause. A query like `SELECT * FROM users` with no WHERE, LIMIT, JOIN with ON, GROUP BY, or HAVING triggers an ESCALATE decision, requiring explicit human approval before execution.

### 5.3 Approval Modes

The approval mode is set per database environment in `wiki.config.yaml`:

| Mode | Behavior |
|------|----------|
| `auto` | All reads are auto-approved |
| `confirm_once` | First read needs approval, then the session is approved |
| `confirm_each` | Every read needs individual approval |
| `grant_required` | Only reads with an active time-limited grant are allowed |

Grants are in-process only -- they use `performance.now()` (process-relative monotonic clock), so a grant written in one CLI invocation does NOT carry into the next one. The default `grant_duration_hours` is 8 (configurable per environment).

### 5.4 Connection Pool Management

The connection pool registry (`.claude/agents/lib/wiki_db/connection.ts`) manages one pool per environment:

```
getConnection("dev")
  |
  v
Pool exists for "dev"?
  |
  NO --> _buildPool("dev")
  |       |
  |       +-- Look up EnvironmentConfig for "dev"
  |       +-- Determine driver name (e.g., "postgresql")
  |       +-- Look up driver factory in registry
  |       +-- Instantiate driver
  |       +-- Log "pool_created" audit event
  |       +-- Store in _pools map
  |
  YES --> Reuse existing pool
  |
  v
driver.connect(envConfig)  --> returns native connection handle
  |
  v
Register handle in openConnections set
  |
  v
Return Connection { envName, native, driver }
```

**Lifecycle management:**
- `releaseConnection()` closes the native handle and removes it from the pool's tracking set
- `shutdownAll()` drains all pools (awaits each driver's `shutdown()` for proper pool teardown)
- SIGINT/SIGTERM/exit handlers are installed on first `getConnection()` call for automatic cleanup

### 5.5 The 6 Pluggable Database Drivers

Drivers are registered via a factory pattern (`.claude/agents/lib/wiki_db/drivers/register.ts`):

```typescript
registerDriverFactory("postgresql", () => new PostgresDriver());
registerDriverFactory("postgres", () => new PostgresDriver());   // alias
registerDriverFactory("mysql", () => new MysqlDriver());
registerDriverFactory("sqlserver", () => new SqlServerDriver());
registerDriverFactory("mssql", () => new SqlServerDriver());     // alias
registerDriverFactory("mongodb", () => new MongoDriver());
registerDriverFactory("mongo", () => new MongoDriver());         // alias
registerDriverFactory("dynamodb", () => new DynamoDriver());
registerDriverFactory("dynamo", () => new DynamoDriver());       // alias
```

SQLite is registered separately in `connection.ts` (it ships as the baseline driver). All 6 Phase E drivers are wired automatically when importing `wiki_db/index.ts`.

Every driver extends the abstract `DatabaseDriver` base class:

```typescript
abstract class DatabaseDriver {
  abstract connect(envConfig): unknown;
  abstract executeRead(conn, query, params?, maxRows?, timeoutMs?): ExecuteReadResult;
  abstract getSchema(conn, schemaName?, tableFilter?): Table[];
  abstract close(conn): void;
  abstract classifyOperation(query): OperationType;
}
```

Phase E drivers additionally implement:
- `executeReadAsync()` -- async query execution (SQL drivers run in `BEGIN READ ONLY` transactions with server-side `statement_timeout`)
- `getSchemaAsync()` -- async schema introspection
- `healthCheck()` -- driver-specific liveness probes (MongoDB `ping`, DynamoDB `ListTables`, SQL drivers `SELECT 1`)
- `shutdown()` -- pool drain on process teardown

**The `adaptDriver` pattern:** Sync drivers (SQLite) only expose `executeRead()`. The query pipeline requires `executeReadAsync()`. The `adaptDriver()` function in `db_query.ts` wraps the sync result in `Promise.resolve()`, making SQLite compatible with the async pipeline without modifying the driver itself.

### 5.6 Query Execution Pipeline

The full journey of a query (`.claude/agents/lib/wiki_db/query.ts`):

```
executeQuery(driver, sql, policy, options)
  |
  v
1. policy.checkQuery(sql)
  |
  +-- DENY       --> return {status: "denied", reason}
  +-- PRESENT_ONLY --> return {status: "present_only", formatted_sql}
  +-- ESCALATE   --> return {status: "escalate", reason}
  +-- ALLOW      --> continue to step 2
  |
  v
2. driver.executeReadAsync(conn, sql, params, maxRows, timeoutMs)
  |
  +-- Error      --> return {status: "error", error_code, error}
  +-- Success    --> return {status: "ok", rows, columns, row_count, truncated}
```

The function never throws -- all exceptions are caught and returned as `{status: "error"}` dicts. Execution time is measured via `performance.now()` and included in every response.

### 5.7 Schema Introspection

The `SchemaManager` class caches `driver.getSchema()` results with a TTL (default 300s). For SQL databases, schema introspection queries `information_schema` tables to discover table names, columns, data types, nullability, primary keys, and defaults.

The schema output includes an automatic Mermaid ER diagram:

```json
{
  "status": "ok",
  "tables": [
    {
      "name": "users",
      "schema": "public",
      "columns": [
        {"name": "id", "data_type": "bigint", "nullable": false, "is_primary_key": true},
        {"name": "email", "data_type": "varchar", "nullable": false}
      ]
    }
  ],
  "table_count": 12,
  "mermaid": {
    "type": "erDiagram",
    "title": "Database Schema",
    "code": "erDiagram\n    users {\n        bigint id PK\n        varchar email\n    }"
  }
}
```

### 5.8 Audit Trail

Every policy decision, query execution, and lifecycle event is logged to a JSONL file (`.claude/agents/lib/wiki_db/audit.ts`):

| Event Type | When |
|------------|------|
| `pool_created` | First connection to an environment |
| `query` | After query execution (with row count, execution time) |
| `schema_inspect` | After schema introspection (with column count) |
| `policy_deny` | When a query is blocked by policy |
| `policy_present_only` | When DML is intercepted and displayed |
| `grant_added` | When a time-limited grant is created |
| `grant_expired` | First time an expired grant is detected |
| `connection_released` | When a connection is returned to the pool |

**Security features:**
- Credentials in SQL strings are scrubbed before logging (`password='...'`, `token="..."`, `api_key=...` are masked)
- Scrubbing happens before truncation so split credentials can't leak
- Audit logging is best-effort -- errors are swallowed so logging never breaks query execution

### 5.9 CLI Entry Point

The `db_query.ts` script (`.claude/agents/wiki-db-agent/scripts/db_query.ts`) exposes two connection modes:

```bash
# Environment mode (from wiki.config.yaml)
node db_query.js --env dev --config ./wiki.config.yaml --sql "SELECT 1"
node db_query.js --env dev --action schema --filter "user%"

# Direct SQLite mode (for tests and ad-hoc work)
node db_query.js --sqlite ./test.db --sql "SELECT name FROM users"
```

Environment mode resolves the driver, approval mode, and credentials from `wiki.config.yaml` -> `ecosystem.database.environments.<name>`.

### 5.10 End-to-End: From Config to Wiki Page

```
1. wiki.config.yaml defines:
   ecosystem.database.driver: postgresql
   ecosystem.database.environments.dev:
     host: localhost
     port: 5432
     database: mydb
     approval_mode: auto

2. Wiki skill calls:
   node db_query.js --env dev --config wiki.config.yaml --action schema

3. Pipeline executes:
   resolveEnv("dev") --> EnvironmentConfig
   registerEnvironment("dev", config)
   getConnection("dev") --> PostgresDriver --> pg.Pool --> client
   driver.getSchemaAsync(conn) --> queries information_schema
   Converts Table[] to Mermaid ER diagram
   Emits schema_inspect audit event
   releaseConnection("dev", conn)
   Returns JSON: {status: "ok", tables: [...], mermaid: {...}}

4. Wiki skill parses JSON, compiles wiki page documenting the schema
```

---

## 6. ORM Agent Deep-Dive

The ORM agent (`wiki-orm-agent`) is a **mapper** agent -- it analyzes your codebase (not an external service) to detect entity-to-table mappings and produce structured documentation.

### 6.1 The 7 ORM Profiles

Each ORM family is defined as a YAML profile under `.claude/agents/lib/wiki_orm/profiles/`:

| Profile | Language | Entity Marker | Table Mapping |
|---------|----------|---------------|---------------|
| `jpa.yaml` | Java | `@Entity` | `@Table(name="...")` |
| `sqlalchemy.yaml` | Python | `class X(.*Base.*)` | `__tablename__ = "..."` |
| `django.yaml` | Python | `class X(models.Model)` | `Meta: db_table = "..."` |
| `prisma.yaml` | TypeScript | `model X {` | `@@map("...")` |
| `typeorm.yaml` | TypeScript | `@Entity()` decorator | `@Entity("name")` |
| `entity_framework.yaml` | C# | `public class X` | `[Table("...")]` |
| `activerecord.yaml` | Ruby | `class X < ApplicationRecord` | `self.table_name = "..."` |

**Profile structure (example: SQLAlchemy):**

```yaml
name: sqlalchemy
language: python
description: "SQLAlchemy ORM for Python"

detection:
  file_patterns: ["**/*.py"]
  markers:                          # Substring-matched (fast, literal)
    - pattern: "declarative_base()"
      type: base_declaration
    - pattern: "__tablename__"
      type: table_mapping
    - pattern: "Column("
      type: column_definition

entity_extraction:                  # Regex patterns (compiled at load time)
  class_pattern: "class\\s+(\\w+)\\s*\\(.*Base.*\\)"
  table_pattern: "__tablename__\\s*=\\s*['\"]([\\w.]+)['\"]"
  column_pattern: "(\\w+)\\s*=\\s*Column\\("

relationship_detection:
  patterns:
    - pattern: "relationship\\("
      type: relationship
    - pattern: "ForeignKey\\("
      type: foreign_key

naming_conventions:
  table_from_class: snake_case      # Fallback: class "User" -> table "users"
  column_from_field: snake_case
```

Key design decisions:
- **Detection markers are substrings** (not regex) for fast, literal matching during the initial scan
- **Extraction patterns are regex** compiled at load time by `loadProfile()` -- a bad pattern immediately throws `ProfileValueError` with the file path and offending pattern
- **Naming conventions** provide fallback inference when the regex doesn't find an explicit table name

### 6.2 Entity Extraction Pipeline

The extractor (`.claude/agents/lib/wiki_orm/extractor.ts`) uses a three-pass windowed algorithm:

```
Pass 1: Find all entity class positions
  |
  v
For each class, define a character window
  (from this class to the start of the next)
  |
  v
Pass 2: Within each window, extract:
  - Table name (regex from profile, or infer from class name via naming conventions)
  - Columns (regex from profile)
  - Relationships (regex from profile)
  |
  v
Pass 3: Resolve relationship targets
  1. TypeORM arrow function: () => ClassName
  2. Call first argument: relationship("Order", ...)
  3. Generic type: List<Foo> (JPA)
  4. Simple field type: Foo foo;
```

**Special handling:**
- SQLAlchemy `secondary=user_roles` captures many-to-many bridge tables explicitly
- Prisma captures the type BEFORE the `@relation` marker (different from other ORMs)
- Windowed scoping prevents cross-class contamination when multiple entities are in one file

**Output:** `ExtractedEntity[]` with class name, table name, schema, columns, relationships, and source file path.

### 6.3 Two Extraction Paths: Regex vs. Serena MCP

The ORM agent supports two extraction strategies:

**Regex path (default):** The extractor reads file contents and applies profile regex patterns. Works everywhere (CI, offline, any environment).

**Serena MCP path (preferred when available):** When the Serena MCP server is connected to the Claude Code session, the agent uses symbol-aware code search instead of regex:

```
1. loadProfile() --> ORM profile with patterns
2. buildExtractionRequest(profile) --> SerenaQueryPlan
3. For each pattern in plan:
   - mcp__plugin_serena_serena__search_for_pattern (find matching code)
   - mcp__plugin_serena_serena__find_symbol (resolve class definitions)
   - mcp__plugin_serena_serena__find_referencing_symbols (find relationships)
4. parseSerenaMatches(matches, profile) --> ExtractedEntity[]
```

Serena provides more accurate detection because it understands code structure (enclosing classes, symbol references) rather than relying on line-by-line regex. But both paths produce the same `ExtractedEntity[]` output -- the downstream pipeline (cross-validation, markdown generation, Mermaid diagrams) is identical.

### 6.4 Cross-Validation Against a Live Database

When `--env <name>` is passed and `ecosystem.orm.cross_validate_against_db` is `true` in the config, the ORM agent cross-validates extracted entities against the actual database schema:

```
Extracted entities (from code)  <-->  Database schema (from wiki-db-agent)
        |                                      |
        v                                      v
   Entity classes                         Table definitions
   Table mappings                         Column metadata
   Column names                           Primary keys
        |
        v
   Cross-validation report:
     - Unmapped tables (in DB but no entity)
     - Orphan entities (entity but no DB table)
     - Column mismatches (type/name differences)
```

Connection failures don't crash the CLI -- they surface as an `error` string in the `cross_validation` report and every entity gets listed as an orphan.

### 6.5 Output: database-mapping.md

The output generator (`.claude/agents/lib/wiki_orm/output.ts`) produces a markdown file with:

1. **YAML frontmatter** (title, tags, ORM profile, timestamps)
2. **Entity-Table Mapping table** (Entity Class | Schema.Table | Columns | Relationships)
3. **Unmapped Tables section** (if cross-validation found DB tables with no entity)
4. **Dual-Access Tables section** (tables accessed by both ORM and direct SQL)
5. **Cross-Validation report** (mismatches between code and DB)
6. **Mermaid ER diagram** (required output, not optional)

**Mermaid deduplication:** Bidirectional relationships (`User.one_to_many -> Order` AND `Order.many_to_one -> User`) are canonicalized to a single edge by unordered table pair. The "natural" direction wins (one_to_many preferred over many_to_one; many_to_many always wins).

---

## 7. Shared Infrastructure

All agents share common libraries under `.claude/agents/lib/`:

### 7.1 CLI Parser (`_agent_cli.ts`)

The 6 source agents (github, jira, confluence, notion, aws, gcp) previously each had ~45 lines of identical argument parsing. `parseAgentArgs()` centralizes this:

```typescript
import { parseAgentArgs } from "../lib/_agent_cli.js";

const args = parseAgentArgs(process.argv.slice(2), {
  flags: ["action", "params"]
});
// args.action = "repo_info"
// args.params = '{"owner": "acme", "repo": "backend"}'
```

Design choices:
- **Whitelist validation** -- unknown flags throw immediately (no silently-ignored flags)
- **No positionals** -- bare arguments throw (all values must be keyed with `--flag`)
- **Duplicate-key consolidation** -- last value wins for repeated flags

### 7.2 Fetch Helper (`fetch_helper.ts`)

HTTP fetch wrapper with global safety caps (per v2 design section 9):

- **Max body size:** 50 MB (enforced by streaming + byte counting)
- **Timeout:** 60 seconds (via `AbortController`)
- If `Content-Length` exceeds the cap, the request is aborted before reading the body

### 7.3 Security Checks (`security_check.ts`)

Centralized validation used by both skills and agents:

- **URL validation:** Only `http://` and `https://` schemes allowed
- **Path containment:** Resolves symlinks, detects directory traversal attacks
- **Label sanitization:** Strips control characters, HTML-escapes special characters, enforces max length (256 chars)

### 7.4 Mermaid Formatter (`mermaid_format.ts`)

Standardizes diagram output so the wiki compiler can splice directly into markdown:

```typescript
interface MermaidBlock {
  type: string;    // "graph TB", "erDiagram", "pie", etc.
  title: string;   // Human-readable title
  code: string;    // Full Mermaid source including type header
}
```

Provides helpers for label sanitization (Mermaid-specific escaping of `"`, `[`, `]`, `{`, `}`, etc.) and node ID generation (alphanumeric + underscore only).

### 7.5 Config Parser (`parse_config.ts`)

Reads and validates `wiki.config.yaml`. Shared between the skill scripts and agent libraries. Handles the dual credentials block (top-level `credentials` takes precedence over `ecosystem.credentials`) and converts YAML kebab-case keys to TypeScript snake_case.

---

## 8. Configuration Reference

The relevant sections of `wiki.config.yaml` that control source/agent behavior:

### Agent Enablement

```yaml
ecosystem:
  agents:
    source: {}              # Populated by /wiki-onboard
    custom: []              # Custom source agents (user-defined)
    model_overrides: {}     # Per-agent model overrides
```

### Database Configuration

```yaml
ecosystem:
  database:
    enabled: true
    driver: postgresql      # Default driver for all environments
    environments:
      dev:
        host: localhost
        port: 5432
        database: mydb
        user_secret: "WIKI_DB_DEV_USER"       # Resolved via credential provider
        password_secret: "WIKI_DB_DEV_PASSWORD"
        approval_mode: auto     # auto | confirm_once | confirm_each | grant_required
      prod:
        host: prod.db.example.com
        port: 5432
        database: mydb
        approval_mode: grant_required
        grant_duration_hours: 8
    policy:
      block_ddl: true
      block_privilege: true
      dml_mode: present_only
      escalate_unbounded_reads: true
    audit:
      enabled: true
      path: "~/.wiki/db_audit.jsonl"
```

### ORM Configuration

```yaml
ecosystem:
  orm:
    enabled: true
    profiles: ["jpa"]                    # Auto-detected by /wiki-onboard
    custom_profiles: []                  # Paths to custom profile YAMLs
    cross_validate_against_db: true      # Compare entities vs live schema
```

### Credential Providers

```yaml
credentials:
  provider: keychain        # Primary: keychain | env_var | file | cloud_secrets
  fallback: [env_var]       # Fallback chain
  prefix: "WIKI_"           # Env var prefix (WIKI_DB_DEV_USER, etc.)
```

### Security Caps

```yaml
security:
  url_schemes: ["http", "https"]
  fetch_size_cap_mb: 50
  fetch_timeout_s: 60
  path_containment_check: true
  label_sanitization:
    strip_control_chars: true
    max_length: 256
    html_escape: true
```

---

## 9. How It All Connects

Here's the complete flow, starting from zero:

```
1. USER RUNS /wiki-onboard
   |
   +-- Phase 1: Scan build files --> detect Java + Maven
   +-- Phase 2: Dispatch wiki-orm-agent --> detect JPA, 23 entities
   +-- Phase 3: Dispatch wiki-db-agent --> detect PostgreSQL on localhost:5432
   +-- Phase 4: Q&A --> enable Jira + GitHub agents
   +-- Phase 5: Choose balanced autonomy
   +-- Phase 6: Write wiki.config.yaml, scaffold wiki/
   |
   v
2. USER RUNS /wiki-ingest src/main/java/com/acme/model/
   |
   +-- Parse config, check cache
   +-- Read all .java entity files
   +-- Surface takeaways: "23 JPA entities mapping to 20 database tables"
   +-- Dispatch in parallel:
   |     +-- wiki-github-agent: fetch repo metadata, recent PRs
   |     +-- wiki-jira-agent: search for related issues
   |     +-- wiki-orm-agent: extract entity mappings
   |     +-- wiki-db-agent: introspect live schema
   +-- Collect JSON responses
   +-- Compile wiki page: "Data Model Architecture"
   +-- Splice Mermaid ER diagram from db-agent + orm-agent responses
   +-- Generate "How to Go Deeper" section with agent commands
   +-- Update summaries.md index
   +-- Log event with per-agent cost metrics
   +-- Run crosslink + tag-harmonize hooks
   |
   v
3. WIKI NOW CONTAINS:
   wiki/data-model-architecture.md
     - Frontmatter (title, type, tags, sources, quality score)
     - Entity-table mapping documentation
     - Mermaid ER diagram (auto-generated, idempotent markers)
     - Cross-references to related pages
     - "How to Go Deeper" section with exact agent commands
     - Claims with confidence scores
```

The system is designed so that each piece is independently useful but compounds when combined. The database agent can run standalone for schema documentation. The ORM agent can run standalone for code-to-table mapping. But when both are enabled and cross-validation is on, you get a complete picture: which entities map to which tables, which tables have no entity, and where the code and database disagree.
