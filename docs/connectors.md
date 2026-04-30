# Connectors and the `narai-primitives` Stack

doc-wiki itself does not talk to GitHub, Jira, Confluence, Notion, AWS, GCP, or your databases. All external-source fetching is delegated to a single dependency: [`narai-primitives`](https://github.com/narailabs/narai-primitives), a bundled package that ships a planner-dispatcher (`gather()`), a connector framework (the toolkit), a config loader, and seven read-only built-in connectors. Credentials are resolved by a separately published package, [`@narai/credential-providers`](#credential-providers).

This document is the API and operations reference for that stack. For doc-wiki's *use* of `gather()` (the `/wiki-ingest` step 7 hook, the `mermaid_augment.ts` decoration site), see [`architecture.md`](architecture.md).

## Table of contents

- [Why `narai-primitives`](#why-narai-primitives)
- [Package map](#package-map)
- [`gather()` — the planning hub](#gather--the-planning-hub)
- [The toolkit](#the-toolkit)
- [The config module](#the-config-module)
- [Credential providers](#credential-providers)
- [The seven built-in connectors](#the-seven-built-in-connectors)
  - [`db`](#db-connector)
  - [`github`](#github-connector)
  - [`jira`](#jira-connector)
  - [`confluence`](#confluence-connector)
  - [`notion`](#notion-connector)
  - [`aws`](#aws-connector)
  - [`gcp`](#gcp-connector)
- [Adding a custom local connector](#adding-a-custom-local-connector)
- [Contributing a built-in connector](#contributing-a-built-in-connector)
- [Wiki-side decoration: `mermaid_augment.ts`](#wiki-side-decoration-mermaid_augmentts)

## Why `narai-primitives`

Pre-2.0, doc-wiki depended on eight separate `@narai/*` packages: `connector-hub`, `connector-toolkit`, `connector-config`, and one `*-agent-connector` package per service (`db`, `github`, `jira`, `confluence`, `notion`, `aws`, `gcp`). Maintaining eight packages with synchronized release cadences was a tax on every change.

With `narai-primitives@2.0.0`, all eight are bundled into a single deliverable. The eight legacy packages are deprecated on npm. `@narai/credential-providers` stays separate because it is reused by other tools (not just `narai-primitives`).

Practical effect for doc-wiki:

- **One install:** `npm install narai-primitives` (already in `package.json`).
- **One import path:** `import { gather } from "narai-primitives";`. Sub-paths cover the toolkit (`narai-primitives/toolkit`), config (`narai-primitives/config`), and the connectors (`narai-primitives/db`, etc.).
- **One CLI namespace:** `npx narai jira list_issues --project AUTH` (the umbrella dispatcher), with back-compat aliases like `npx jira-agent-connector`.

## Package map

```
narai-primitives/
├── src/
│   ├── hub/                 # gather() planner + dispatcher
│   ├── toolkit/             # createConnector(), security helpers, policy, audit, hardship
│   ├── config/              # YAML loader, schema, env + consumer overlays
│   ├── connectors/
│   │   ├── db/              # SQL + NoSQL drivers + policy gate
│   │   ├── github/          # GitHub REST API
│   │   ├── jira/            # Jira Cloud REST
│   │   ├── confluence/      # Confluence Cloud REST
│   │   ├── notion/          # Notion API
│   │   ├── aws/             # AWS SDK v3 clients
│   │   └── gcp/             # gcloud / bq CLI shellouts
│   └── cli/                 # narai umbrella dispatcher
└── plugins/                 # plugin skill definitions (not on npm)
```

| Sub-path | Default export |
|---|---|
| `narai-primitives` | `gather()` (the hub) |
| `narai-primitives/hub` | `gather()` (same) |
| `narai-primitives/toolkit` | `createConnector()`, `parseAgentArgs`, `fetchWithCaps`, `validateUrl`, `checkPathContainment`, `sanitizeLabel` |
| `narai-primitives/config` | `loadResolvedConfig()`, types |
| `narai-primitives/db` | The `db` connector factory and types |
| `narai-primitives/github` | The `github` connector factory and types |
| (same for `jira`, `confluence`, `notion`, `aws`, `gcp`) | … |

Source repository: https://github.com/narailabs/narai-primitives

## `gather()` — the planning hub

`gather()` is the only function doc-wiki imports from `narai-primitives` directly. It plans a multi-connector dispatch from a natural-language prompt and returns the results in parallel.

### Signature

```ts
import { gather } from "narai-primitives";

const out = await gather({
  prompt: "What was the last commit on main in narailabs/foo?",
  consumer: "doc-wiki",
});
console.log(out.plan);     // PlanStep[]
console.log(out.results);  // DispatchResult[]
```

### Input

```ts
type GatherInput = {
  prompt: string;            // The natural-language request
  consumer?: string;         // Config consumer override (e.g., "doc-wiki")
  environment?: string;      // Config environment override (e.g., "prod")
  extraContext?: string;     // Optional extra instructions appended to the system prompt
};
```

### Output

```ts
type GatherOutput = {
  plan: PlanStep[];          // The planner's chosen steps (after validation)
  results: DispatchResult[]; // One entry per plan step
};

type PlanStep = {
  connector: string;         // e.g., "github"
  action: string;            // e.g., "search_code"
  params: Record<string, unknown>;
};

type DispatchResult = {
  step: number;              // sequential index
  connector: string;
  action: string;
  params: Record<string, unknown>;
  envelope?: unknown;        // connector's JSON envelope on success
  error?: {
    code: string;            // e.g., "TIMEOUT", "DISPATCH_FAILED", "CLI_NOT_FOUND"
    message: string;
  };
};
```

### Plan-then-dispatch flow

1. Load config (user-global + per-repo overlay; apply env + consumer overrides).
2. Build a system prompt by concatenating each enabled connector's `SKILL.md` verbatim.
3. Send the system + user prompt to the planner. The default planner is `AgentSdkPlanner`, which uses `@anthropic-ai/claude-agent-sdk`'s `query()` with `maxTurns: 1` and an empty tool list — Claude returns a JSON array of plan steps.
4. Validate plan entries (drop ones with bad connector names, empty actions, or non-object params; surface dropped entries as `DispatchResult.error`).
5. Dispatch each valid step in parallel via `child_process.spawn`, with concurrency cap (default 8) and per-step timeout (default 60 s).
6. Collect each child's stdout, parse as JSON, and assemble `DispatchResult[]`.

### Subprocess safeguards

- **Timeouts:** SIGTERM after `timeout_ms`, then SIGKILL after a 2-second grace period.
- **stdout cap:** default 50 MB; oversized stdout fails the step with `STDOUT_CAP_EXCEEDED`.
- **AbortSignal:** cancellation mid-gather is supported; in-flight children get SIGTERM.
- **Parent-exit cleanup:** if the parent process exits (SIGINT / SIGTERM), all in-flight children are sent SIGTERM before the parent dies.

### Error surface

Per-step errors are structured and never thrown:

| `error.code` | Meaning |
|---|---|
| `TIMEOUT` | Connector exceeded its time budget |
| `DISPATCH_FAILED` | Subprocess died unexpectedly (non-zero exit, signal, parse failure) |
| `STDOUT_CAP_EXCEEDED` | Connector wrote >50 MB to stdout |
| `CLI_NOT_FOUND` | The connector CLI couldn't be located on disk |
| `UNAUTHORIZED` | Connector reported credential failure |
| `RATE_LIMITED` | Connector hit a rate limit |
| `CONFIG_ERROR` | Connector misconfiguration (e.g., missing optional dep, bad params) |

The caller sees `out.results[i].error.code` and decides whether to fail the operation or carry on with partial results. doc-wiki's `/wiki-ingest` carries on with whatever envelopes succeeded.

### Source files

- Hub orchestration: `narai-primitives/src/hub/index.ts`
- Planner: `narai-primitives/src/hub/plan.ts`
- Dispatcher + safeguards: `narai-primitives/src/hub/dispatch.ts`
- Public types: `narai-primitives/src/hub/types.ts`

## The toolkit

Every built-in connector is built with `createConnector()` from `narai-primitives/toolkit`. The toolkit also provides the security primitives doc-wiki uses directly (via `import { ... } from "narai-primitives/toolkit"`).

### `createConnector(config)`

Builds a production-ready connector with:

- A CLI harness that parses `--action`, `--params`, `--curate`, `--help`.
- An approval-gate (universal policy engine: ALLOW / ESCALATE / DENY). Connectors may register extra decisions via `policyExtras` — e.g. db-agent adds `PRESENT` for "displayed but not executed".
- Audit logging (structured action / policy events).
- Hardship recording (error clustering for self-improvement prompts).
- Lazy SDK and credential loading (per-action, not on connector start).
- Error envelope translation (canonical `ErrorCode` enum).

Connector authors define a list of action specs (zod-validated input, handler function, classification keyword) and an SDK-loader. The toolkit provides everything else.

### Security helpers

| Function | Purpose |
|---|---|
| `validateUrl(url)` | Whitelist `http://` and `https://`. Throws `InvalidUrlError` on anything else. |
| `checkPathContainment(path, root)` | Resolve symlinks, then verify the path is inside `root`. Returns boolean. **TOCTOU note:** the resolve and the check are two syscalls — relies on running on a private filesystem (developer workstation, CI runner, sandboxed container). |
| `fetchWithCaps(url, init?, caps?)` | HTTP fetch with size + timeout caps. Defaults: 50 MB / 60 s. Composable with external `AbortSignal`. Throws `FetchCapExceeded` if response too large. |
| `sanitizeLabel(label, maxLen?)` | Strip control chars (`U+0000–001F`, `U+007F–009F`), HTML-escape, cap length (default 200). |

### CLI helpers

| Function | Purpose |
|---|---|
| `parseAgentArgs(argv, flagSpecs?)` | Parse `--flag value` pairs into a typed object |
| `resolveAgentCli(opts)` | 4-level fallback for finding the connector CLI on disk |

The 4-level CLI resolution:

1. `<NAME>_AGENT_CLI` env var (operator escape hatch).
2. `~/.claude/plugins/cache/<name>-agent-plugin*` (Claude Code plugin manager install).
3. `${CLAUDE_PLUGIN_DATA}/node_modules/@narai/<name>-agent-connector/dist/cli.js` (SessionStart hook install).
4. `~/src/connectors/<name>-agent-connector/dist/cli.js` (developer fallback).

For doc-wiki users, the npm install of `narai-primitives` covers paths 3 and 4 transparently.

## The config module

The config module loads YAML from `~/.connectors/config.yaml` (user-global) and `./.connectors/config.yaml` (per-repo overlay), validates secret refs, applies environment + consumer overlays, and returns a `ResolvedConfig`. `gather()` calls `loadResolvedConfig()` automatically.

For the full schema (every key, default, and example), see [`configuration.md`](configuration.md).

Public API:

```ts
import { loadResolvedConfig } from "narai-primitives/config";

const cfg = await loadResolvedConfig({
  consumer: "doc-wiki",   // overlay consumers.doc-wiki on top
  environment: "prod",    // overlay environments.prod on top
});
```

`ResolvedConfig` shape:

```ts
type ResolvedConfig = {
  hub: { model: string | null; max_tokens: number | null };
  policy: PolicyMap;
  enforce_hooks: boolean;
  model: string | null;
  environment: string | null;
  consumer: string | null;
  connectors: Record<string, ResolvedConnector>;
};

type ResolvedConnector = {
  name: string;
  enabled: boolean;
  skill: string;          // CLI name or path
  model: string | null;
  enforce_hooks: boolean;
  policy: PolicyMap;
  options: Record<string, unknown>;  // connector-specific settings
};
```

The resolution order is: user-global → per-repo overlay (wins on conflict) → environments overlay → consumers overlay.

## Credential providers

`@narai/credential-providers` is a separate npm package, kept out of `narai-primitives` because it's reused by other Narailabs tools. doc-wiki has it as a direct dependency (`@narai/credential-providers@^0.2.1`).

### Reference grammar

Credential refs in `.connectors/config.yaml` follow this grammar:

| Form | Resolution |
|---|---|
| `env:VAR_NAME` | `process.env.VAR_NAME` |
| `keychain:LABEL` | OS keychain entry (macOS Keychain or libsecret on Linux) |
| `file:/path/to/key` | File contents (with permission check) |
| `cloud:aws-secret/<arn>` | AWS Secrets Manager (uses default AWS credential chain) |
| `cloud:gcp-secret/<resource>` | GCP Secret Manager (uses Application Default Credentials) |

Mixing forms in one config is fine: `token: env:GITHUB_TOKEN` and `password: keychain:db-prod` can coexist.

### Public API

```ts
import {
  resolveSecret,
  registerProvider,
  CredentialResolver,
  EnvVarProvider,
  KeychainProvider,
  FileProvider,
  CloudSecretsProvider,
  parseCredentialRef,
} from "@narai/credential-providers";

// Resolve a single ref:
const token = await resolveSecret("env:GITHUB_TOKEN");

// Register a custom provider:
registerProvider("vault", new MyVaultProvider());
```

### Where resolution happens

Crucially, credential resolution happens **inside the connector subprocess**, not in doc-wiki. The hub passes the connector its config slice via `NARAI_CONFIG_BLOB` (a JSON-stringified env var); the connector then calls `resolveSecret()` for each ref it needs.

Doc-wiki itself never sees a cleartext credential. Even if you log `gather()` results, you'll see API responses, not tokens.

This is invariant **#4** in [the architecture contracts](architecture.md#architecture-contracts).

## The seven built-in connectors

Every connector follows the same pattern:

- Built on `createConnector()`.
- Has a CLI binary (e.g., `db-agent-connector`, accessible via `npx narai db <action>`).
- Returns a JSON envelope on success: `{ status: "ok", data: {...} }`.
- Returns a structured envelope on failure: `{ status: "denied" | "escalate" | "error", reason: ..., code: ... }`.
- Loads credentials lazily via `@narai/credential-providers`.
- Lazy-imports its SDK (so installing `narai-primitives` doesn't pull every cloud SDK upfront).

### `db` connector

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

**Credentials:** Per-environment block in `.connectors/config.yaml`:

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

- `query` — execute a read-only SQL query: `--params '{"env":"dev","sql":"SELECT * FROM users","max_rows":1000,"timeout_ms":30000}'`
- `schema` — describe schema: `--params '{"env":"dev","filter":"public.*"}'`

**Policy gate (the marquee feature):**

The `db` connector classifies every SQL statement by leading keyword:

| Keyword(s) | Classification |
|---|---|
| `SELECT`, `WITH`, `EXPLAIN`, `DESCRIBE`, `SHOW` | `read` |
| `INSERT`, `UPDATE`, `DELETE`, `MERGE`, `REPLACE` | `write` |
| `DROP`, `TRUNCATE` | `delete` |
| `CREATE`, `ALTER`, `RENAME` | `admin` |
| `GRANT`, `REVOKE` | `privilege` |
| (anything else) | unknown — **default deny** |

The classification is then matched against the configured policy (per-action, per-environment) and produces one of four decisions:

| Decision | Meaning |
|---|---|
| `allow` | Execute the query, return rows |
| `deny` | Refuse to execute. Envelope: `{ status: "denied", reason, formatted_sql }` |
| `escalate` | Pause and escalate to human approval (via the toolkit's `ApprovalEngine`). Envelope: `{ status: "escalate", reason }` |
| `present_only` | Show the formatted SQL without executing. Envelope: `{ status: "present_only", formatted_sql, reason }` (db-only outcome) |

Default policy in `.connectors/config.example.yaml` is conservative: `read` allowed in dev, escalate in prod; `write` / `delete` / `admin` / `privilege` denied everywhere unless explicitly opened.

### `github` connector

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

### `jira` connector

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

### `confluence` connector

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

### `notion` connector

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

### `aws` connector

**Wraps:** AWS SDK v3 (CloudWatch metrics, Lambda info, RDS instances, S3 buckets, DynamoDB tables, STS identity).

**CLI:** `aws-agent-connector` or `npx narai aws <action>`.

**SDK loading:** Each AWS SDK client is lazy-imported on demand. Missing client packages surface as `CONFIG_ERROR` envelopes. The relevant client packages are listed under `optionalDependencies` in [`package.json`](../package.json).

**Credentials:** Uses the standard AWS credential chain — environment variables (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`, `AWS_REGION`), `~/.aws/credentials`, IAM role. Override via the connector's `profile` option:

```yaml
connectors:
  aws:
    enabled: true
    skill: aws-agent-connector
    region: env:AWS_REGION
    # profile: my-profile          # optional, when not using default
```

### `gcp` connector

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

## Adding a custom local connector

For a SaaS / API / CLI that isn't in the seven built-ins, use the [`/create-connector`](https://github.com/narailabs/narai-primitives/blob/main/docs/create-connector.md) skill (installed alongside `narai-primitives`):

```text
/create-connector
```

This scaffolds a minimal connector at `.connectors/connectors/<name>/` (project scope, default) or `~/.connectors/connectors/<name>/` (user scope). No `git init`, no `npm publish`, no plugin manifest, no marketplace entry — just a `cli.ts`, an `actions/` directory, and a `SKILL.md`.

Once scaffolded, register it in `wiki.config.yaml`:

```yaml
ecosystem:
  agents:
    custom:
      - id: stripe
        patterns:
          - https://(api\.|dashboard\.)?stripe\.com/.*
        skill: ./.connectors/connectors/stripe/cli.js
```

doc-wiki's `source_registry.ts` will then route Stripe URLs through your connector when `/wiki-ingest` encounters them.

**Do not** modify an existing connector for ad-hoc behavior. If the change is general-purpose, contribute it upstream (see next section). If it's project-local, scaffold a custom connector instead.

## Contributing a built-in connector

If your connector is broadly useful (would benefit multiple Narailabs tools), open a pull request against [narailabs/narai-primitives](https://github.com/narailabs/narai-primitives). The repository's [`CONTRIBUTING.md`](https://github.com/narailabs/narai-primitives/blob/main/CONTRIBUTING.md) walks through the structure: drop your connector under `src/connectors/<name>/`, add zod schemas for actions, write tests under `tests/connectors/<name>/`, register a CLI binary in the umbrella dispatcher, and add an entry to the package's `exports` map.

doc-wiki's only hook into a new built-in is its entry in `BUILTIN_PATTERNS` in [`source_registry.ts`](../.claude/agents/lib/source_registry.ts) — add it there too, so `/wiki-ingest` routes the right URLs through the new connector.

## Wiki-side decoration: `mermaid_augment.ts`

After `gather()` returns, doc-wiki runs the results through [`mermaid_augment.ts`](../.claude/agents/lib/mermaid_augment.ts). This is the single decoration site for all 7 connectors — it inspects each `DispatchResult.envelope`, recognizes connector-specific shapes (Jira issues, GitHub PRs, schema info from `db`, etc.), and adds a `mermaid: { type, title, code }` field with a wiki-ready Mermaid block.

The wiki page compilation step then splices these blocks into the page (idempotently, via `mermaid_inject.ts`'s `<!-- wiki-mermaid: <title> start/end -->` markers).

If you add a new connector and want the wiki to generate a Mermaid diagram from its envelopes, edit `mermaid_augment.ts` — never the connector itself. The toolkit and connectors stay vendor-neutral; wiki-specific decoration lives at the wiki edge.

This is invariant **#3** in [the architecture contracts](architecture.md#architecture-contracts): one source-fetch path through `gather()`, one decoration site at `mermaid_augment.ts`.
