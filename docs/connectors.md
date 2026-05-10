# Connectors

doc-wiki itself doesn't talk to GitHub, Jira, Confluence, Notion, AWS, GCP, or your databases. External-source fetching is delegated to a single dependency — [`narai-primitives`](https://github.com/narailabs/narai-primitives) — which ships a planner-dispatcher (`gather()`) and seven read-only built-in connectors. This doc is your guide to **which connector fetches what, what credentials it needs, and how to invoke it**.

For the credential-reference grammar (`env:` / `keychain:` / `file:` / `cloud:`) and YAML schema, see [`configuration.md`](configuration.md). For internals — the `gather()` API, toolkit helpers, error codes, contributing a new built-in connector — see [`internals/connectors-api.md`](internals/connectors-api.md).

## Table of contents

- [How connectors plug into doc-wiki](#how-connectors-plug-into-doc-wiki)
- [The seven built-in connectors](#the-seven-built-in-connectors)
  - [`db`](#db)
  - [`github`](#github)
  - [`jira`](#jira)
  - [`confluence`](#confluence)
  - [`notion`](#notion)
  - [`aws`](#aws)
  - [`gcp`](#gcp)
- [Credential reference grammar](#credential-reference-grammar)
- [Adding a custom local connector](#adding-a-custom-local-connector)
- [Filing connector issues](#filing-connector-issues)

## How connectors plug into doc-wiki

Every `/doc-wiki:ingest <source>` runs a 13-step pipeline; step 7 calls `gather({ prompt, consumer: "doc-wiki" })` from `narai-primitives`. The hub:

1. **Reads** your `~/.connectors/config.yaml` (and any `./.connectors/config.yaml` overlay).
2. **Plans** which connectors to call based on the prompt's entities — only enabled connectors that look relevant to the source are dispatched.
3. **Dispatches** the plan in parallel as subprocesses, each carrying its own credential slice.
4. **Returns** a `DispatchResult[]` array; doc-wiki carries on with whatever envelopes succeeded.

You configure connectors **once** (in `~/.connectors/config.yaml`); from then on, every `/doc-wiki:ingest` and every `/doc-wiki:query` that needs external context can use them. Credentials are **lazy** — the secret is only read when a connector actually runs, and only inside the connector's subprocess. doc-wiki never sees the cleartext value.

All seven connectors are **read-only**. The `db` connector additionally ships with a guard-rail policy gate (`ALLOW` / `DENY` / `ESCALATE` / `PRESENT_ONLY`) — see [`db`](#db) below.

## The seven built-in connectors

A consolidated reference. Each connector has its own block under `connectors:` in `~/.connectors/config.yaml`. The starter is at [`.connectors/config.example.yaml`](../.connectors/config.example.yaml) — copy it, uncomment the connectors you want, fill in credential refs.

| Connector | Wraps | Use it for |
|---|---|---|
| [`db`](#db) | SQL + NoSQL drivers | Schema introspection, read-only queries with policy gate |
| [`github`](#github) | GitHub REST API | Repo info, code search, issues, PRs, file contents, releases |
| [`jira`](#jira) | Jira Cloud REST | Issue search by JQL, metadata, comments, sprint info |
| [`confluence`](#confluence) | Confluence Cloud REST | Page content, space search, CQL queries, attachments |
| [`notion`](#notion) | Notion API | Database query, page content, search, property listings |
| [`aws`](#aws) | AWS SDK v3 | CloudWatch metrics, Lambda info, RDS, S3, DynamoDB, STS identity |
| [`gcp`](#gcp) | `gcloud` + `bq` CLIs | Cloud Logging, Compute Engine, BigQuery, GCS, IAM bindings |

### `db`

**Wraps:** SQL and NoSQL databases — read-only query and schema introspection.

**CLI:** `db-agent-connector` or `npx narai db <action>`.

**Drivers (lazy-loaded):**

| Driver | Backing package |
|---|---|
| `sqlite` | `better-sqlite3` (in `dependencies`) |
| `postgresql` (alias: `postgres`) | `pg` (in `dependencies`) |
| `mysql` | `mysql2` (in `dependencies`) |
| `sqlserver` (alias: `mssql`) | `mssql` (in `dependencies`) |
| `mongodb` (alias: `mongo`) | `mongodb` (in `dependencies`) |
| `dynamodb` (alias: `dynamo`) | `@aws-sdk/client-dynamodb` (optional) |
| `oracle` | `oracledb` (optional) |

**Credentials** — per-environment block in `~/.connectors/config.yaml`:

```yaml
connectors:
  db:
    enabled: true
    skill: db-agent-connector
    environments:
      dev:
        driver: postgresql
        host: env:DB_DEV_HOST
        database: env:DB_DEV_NAME
        user: env:DB_DEV_USER
        password: env:DB_DEV_PASSWORD
```

**Actions:**

- `query` — read-only SQL: `--params '{"env":"dev","sql":"SELECT * FROM users","max_rows":1000,"timeout_ms":30000}'`
- `schema` — describe schema: `--params '{"env":"dev","filter":"public.*"}'`

**Policy gate (the marquee feature):** Every SQL statement is classified by leading keyword, then matched against your policy:

| Keyword(s) | Classification |
|---|---|
| `SELECT`, `WITH`, `EXPLAIN`, `DESCRIBE`, `SHOW` | `read` |
| `INSERT`, `UPDATE`, `DELETE`, `MERGE`, `REPLACE` | `write` |
| `DROP`, `TRUNCATE` | `delete` |
| `CREATE`, `ALTER`, `RENAME` | `admin` |
| `GRANT`, `REVOKE` | `privilege` |
| (anything else) | unknown — **default deny** |

The classification → one of four decisions:

| Decision | Meaning |
|---|---|
| `allow` | Execute the query, return rows |
| `deny` | Refuse to execute. Envelope: `{ status: "denied", reason, formatted_sql }` |
| `escalate` | Pause and escalate to human approval |
| `present_only` | Show the formatted SQL without executing (db-only outcome) |

Default policy in `.connectors/config.example.yaml` is conservative: `read` allowed in dev, escalate in prod; `write` / `delete` / `admin` / `privilege` denied everywhere unless explicitly opened.

### `github`

**Wraps:** GitHub REST API.

**CLI:** `github-agent-connector` or `npx narai github <action>`.

**Credentials:**

```yaml
connectors:
  github:
    enabled: true
    skill: github-agent-connector
    token: env:GITHUB_TOKEN     # personal access token
```

**Actions:** `repo_info`, `search_code`, `get_issues`, `get_pulls`, `get_file`, `get_issue_comments`, `get_pr_review_comments`, `list_release_assets`, `get_release_asset`.

**Sample call:**

```sh
npx narai github search_code --params '{"owner":"narailabs","repo":"doc-wiki","query":"applyMermaid"}'
```

**Notable safeguards:** `get_file` rejects paths containing `..` (path traversal prevention). All actions paginate up to 1000 results.

### `jira`

**Wraps:** Jira Cloud REST API.

**CLI:** `jira-agent-connector` or `npx narai jira <action>`.

**Credentials:**

```yaml
connectors:
  jira:
    enabled: true
    skill: jira-agent-connector
    server_url: env:JIRA_SERVER_URL    # e.g. https://your-org.atlassian.net
    email: env:JIRA_EMAIL
    api_token: env:JIRA_API_TOKEN
```

**Actions:** Issue search by JQL, issue metadata, comments, attachments, project metadata, sprint information.

**Sample call:**

```sh
npx narai jira list_issues --params '{"jql":"project = AUTH AND status = Open"}'
```

### `confluence`

**Wraps:** Confluence Cloud REST API.

**CLI:** `confluence-agent-connector` or `npx narai confluence <action>`.

**Credentials:**

```yaml
connectors:
  confluence:
    enabled: true
    skill: confluence-agent-connector
    server_url: env:CONFLUENCE_SERVER_URL
    email: env:CONFLUENCE_EMAIL
    api_token: env:CONFLUENCE_API_TOKEN
```

**Actions:** Page content retrieval, space search, content search by CQL, attachment listing.

### `notion`

**Wraps:** Notion API.

**CLI:** `notion-agent-connector` or `npx narai notion <action>`.

**Credentials:**

```yaml
connectors:
  notion:
    enabled: true
    skill: notion-agent-connector
    token: env:NOTION_TOKEN     # internal integration token
```

**Actions:** Database query, page content retrieval, search pages, list database properties.

### `aws`

**Wraps:** AWS SDK v3 (CloudWatch metrics, Lambda info, RDS instances, S3 buckets, DynamoDB tables, STS identity).

**CLI:** `aws-agent-connector` or `npx narai aws <action>`.

**Credentials** — uses the standard AWS credential chain (env vars `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_SESSION_TOKEN` / `AWS_REGION`, `~/.aws/credentials`, IAM role). Override via the connector's `profile` option:

```yaml
connectors:
  aws:
    enabled: true
    skill: aws-agent-connector
    region: env:AWS_REGION
    # profile: my-profile          # optional, when not using default
```

**SDK loading:** Each AWS SDK client is lazy-imported on demand. Missing client packages surface as `CONFIG_ERROR` envelopes. The relevant client packages are listed under `optionalDependencies` in [`package.json`](../package.json).

### `gcp`

**Wraps:** GCP services via the `gcloud` CLI (Cloud Logging, Compute Engine, BigQuery via `bq`, Cloud Storage, IAM bindings).

**CLI:** `gcp-agent-connector` or `npx narai gcp <action>`.

**Runtime requirement:** `gcloud` CLI on `PATH` and Application Default Credentials configured (`gcloud auth application-default login`). Missing `gcloud` surfaces as `CONFIG_ERROR`. BigQuery actions optionally use the `bq` CLI.

**Credentials:**

```yaml
connectors:
  gcp:
    enabled: true
    skill: gcp-agent-connector
    project_id: env:GCP_PROJECT_ID
    # GOOGLE_APPLICATION_CREDENTIALS picked up automatically when set
```

## Credential reference grammar

Anywhere a value can be a credential ref in `~/.connectors/config.yaml`, use one of these forms:

| Form | Resolution |
|---|---|
| `env:VAR_NAME` | `process.env.VAR_NAME` |
| `keychain:LABEL` | OS keychain entry — macOS Keychain or libsecret on Linux |
| `file:/abs/path` | File contents (with permission check that the file isn't world-readable) |
| `cloud:aws-secret/<arn>` | AWS Secrets Manager (uses default AWS credential chain to authenticate) |
| `cloud:gcp-secret/<resource>` | GCP Secret Manager (uses Application Default Credentials) |

Mixing forms within one file is fine: `token: env:GITHUB_TOKEN` and `password: keychain:db-prod` can coexist. Plaintext values are accepted but **discouraged** — `narai-primitives/config` warns when it sees a connector option that looks like an inline secret.

For resolution order (user-global → per-repo overlay → environments → consumers), see [`configuration.md` § Resolution order](configuration.md#resolution-order).

## Adding a custom local connector

For a SaaS / API / CLI that isn't in the seven built-ins, use the `/create-connector` skill (installed alongside `narai-primitives`):

```text
/create-connector
```

This scaffolds a minimal connector at `.connectors/connectors/<name>/` (project scope, default) or `~/.connectors/connectors/<name>/` (user scope). No `git init`, no `npm publish`, no plugin manifest, no marketplace entry — just a `cli.ts`, an `actions/` directory, and a `SKILL.md`.

Once scaffolded, register it in `wiki.config.yaml` so doc-wiki routes the right URLs through it during ingest:

```yaml
ecosystem:
  agents:
    custom:
      - id: stripe
        patterns:
          - https://(api\.|dashboard\.)?stripe\.com/.*
        skill: ./.connectors/connectors/stripe/cli.js
```

doc-wiki's `source_registry.ts` will then route Stripe URLs through your connector when `/doc-wiki:ingest` encounters them.

**Don't** modify an existing connector for ad-hoc behavior. If the change is general-purpose, contribute it upstream — see [`internals/connectors-api.md` § Contributing a built-in connector](internals/connectors-api.md#contributing-a-built-in-connector). If it's project-local, scaffold a custom connector instead.

## Filing connector issues

- **Bugs in a specific connector** (e.g. Jira returns wrong field, GitHub pagination broken): https://github.com/narailabs/narai-primitives/issues
- **Bugs in how doc-wiki uses connectors** (e.g. wrong source classified, mermaid diagram missing): https://github.com/narailabs/doc-wiki/issues
- **Credential resolver issues**: report under `narai-primitives` issues; the `narai-primitives/credentials` subpath is the same package.

## See also

- [`configuration.md`](configuration.md) — full schema for `~/.connectors/config.yaml`, credential resolution order, worked example.
- [`internals/connectors-api.md`](internals/connectors-api.md) — `gather()` API, toolkit, error codes, contributing a new built-in connector.
- [`recipes.md`](recipes.md) — common multi-connector ingestion workflows.
- [`troubleshooting.md`](troubleshooting.md#gather-returns-empty-plan) — what to do when `gather()` returns an empty plan.
