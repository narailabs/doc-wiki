# Phase 3 Prompt: Extract 6 Source Agents into a 3-Layer Distribution

Paste this into a new Claude Code session (or hand it to an agent) when ready to execute.

---

## Task

Extract the six source agents (`wiki-aws-agent`, `wiki-gcp-agent`, `wiki-notion-agent`, `wiki-confluence-agent`, `wiki-jira-agent`, `wiki-github-agent`) into a **3-layer distribution model** so each layer is independently consumable by people and projects outside doc-wiki:

- **Layer 1** — Vendor-neutral npm packages under the `@narai/` scope. No Claude Code awareness, no doc-wiki coupling. Pure CLI + library. Anyone can `npm install` and use them from any tool.
- **Layer 2** — One Claude Code plugin per connector. Each plugin wraps the matching npm package via a `SKILL.md` (with `context: fork`) plus a slash command. Distributable through a Claude Code plugin marketplace; usable on its own without doc-wiki.
- **Layer 3** — doc-wiki itself remains a Claude Code plugin. Its wrapper agents resolve a connector via a 4-step lookup that prefers the per-connector plugin's installed location, then falls back to npm, then to a local dev path.

While extracting, **add first-class support for comments and attachments** on platforms where those concepts exist (Jira, Confluence, GitHub, Notion). AWS and GCP do not have comments/attachments in the wiki sense and are extracted without that scope.

## Why a 3-layer model

Two Claude Code constraints came up during plan review:

1. **Marketplace plugins do not auto-run `npm install`.** Plugins are copied to `~/.claude/plugins/cache/`. The documented workaround is a `SessionStart` hook that installs deps once into `${CLAUDE_PLUGIN_DATA}` and exposes them via `NODE_PATH`. See https://code.claude.com/docs/en/plugins-reference.md#persistent-data-directory.
2. **Plugins cannot declare other plugins as dependencies.** Bundling or per-plugin install is the only path.

The 3-layer model resolves both: each Layer 2 plugin owns its `SessionStart` hook that installs its Layer 1 npm package; doc-wiki (Layer 3) is independent of whether the user installed any Layer 2 plugins or only the npm packages.

## What was already done

- **Phase 1 (Source Agent Registry)** — `source_registry.ts` + AGENT.md frontmatter contract; custom agents registerable via `ecosystem.agents.custom`.
- **Phase 2 (DB Agent Extraction)** — `wiki-db-agent` is a thin wrapper. The standalone `db-agent-connector` lives outside doc-wiki and is resolved at runtime through a multi-step lookup. Mermaid stays in the wrapper. ORM cross-validation moved to dependency injection through `db_provider.ts` + `wiki_db_provider.ts`. **`db-agent-connector` is currently single-layer (npm only) — Phase 3.5 will retrofit it into the 3-layer pattern after the new connectors validate the model.**

Reference implementation to mirror (Layer 3 only):
- Wrapper script: `.claude/agents/wiki-db-agent/scripts/db_query.ts`
- Wrapper agent definition: `.claude/agents/wiki-db-agent/AGENT.md` ("Architecture" section describes the resolver chain)

---

## 3-layer architecture at a glance

```
Layer 1 — npm packages (~/src/<name>/, published under @narai/*)
   @narai/connector-toolkit                  shared helpers
   @narai/aws-agent-connector                AWS read-only CLI + library
   @narai/gcp-agent-connector                GCP read-only CLI + library
   @narai/notion-agent-connector             Notion read-only CLI + library
   @narai/confluence-agent-connector         Confluence read-only CLI + library
   @narai/jira-agent-connector               Jira read-only CLI + library
   @narai/github-agent-connector             GitHub read-only CLI + library

Layer 2 — per-connector Claude Code plugins (~/src/<name>-agent-plugin/)
   .claude-plugin/plugin.json                manifest
   skills/<service>-agent/SKILL.md           context: fork — runs in subagent
   commands/<service>-agent.md               slash command: /<service>-agent <action> <params>
   hooks/hooks.json                          SessionStart: npm install @narai/<connector>
                                             into ${CLAUDE_PLUGIN_DATA}/node_modules
   bin/                                      thin shim that invokes the npm package CLI

Layer 3 — doc-wiki (existing repo, also a Claude Code plugin)
   .claude/agents/wiki-<service>-agent/scripts/<service>_wrapper.ts
       4-step resolver:
         1. <SERVICE>_AGENT_CLI env var (absolute path override)
         2. ~/.claude/plugins/cache/<service>-agent-plugin/.../node_modules/@narai/<connector>/dist/cli.js
         3. ${CLAUDE_PLUGIN_DATA}/node_modules/@narai/<connector>/dist/cli.js  (when doc-wiki itself is plugin-installed)
         4. ~/src/<service>-agent-connector/dist/cli.js  (local dev fallback)
       After resolving, spawns the CLI as a subprocess and adds wiki-specific
       Mermaid decoration to structural responses.
```

The same 4-step resolver shape applies to every connector. Doc-wiki works whether the user installed (a) the per-connector plugin only, (b) the npm package only, (c) both, or (d) is running from a `git clone` in `~/src/`.

---

## Connector inventory (Layer 1 + Layer 2)

| Layer 1 npm package | Layer 2 plugin | Wraps existing agent | New actions to add |
|---|---|---|---|
| `@narai/aws-agent-connector` | `aws-agent-plugin` | `wiki-aws-agent` | (none — no comments/attachments) |
| `@narai/gcp-agent-connector` | `gcp-agent-plugin` | `wiki-gcp-agent` | (none — no comments/attachments) |
| `@narai/notion-agent-connector` | `notion-agent-plugin` | `wiki-notion-agent` | `get_comments`, `list_attachments`, `get_attachment` |
| `@narai/confluence-agent-connector` | `confluence-agent-plugin` | `wiki-confluence-agent` | `get_comments`, `list_attachments`, `get_attachment` |
| `@narai/jira-agent-connector` | `jira-agent-plugin` | `wiki-jira-agent` | `get_comments`, `list_attachments`, `get_attachment` |
| `@narai/github-agent-connector` | `github-agent-plugin` | `wiki-github-agent` | `get_issue_comments`, `get_pr_review_comments`, `list_release_assets`, `get_release_asset` |

Plus shared:

| Repo | Purpose |
|---|---|
| `@narai/connector-toolkit` | `_agent_cli`, `fetch_helper`, `security_check`, `parse_config`, `credential_providers/` — vendored once, consumed by every connector and (initially) by doc-wiki itself |

Each Layer 1 package exposes a CLI (`bin/<name>-agent-connector`) that takes the **same JSON envelope** the agent receives today (`{action, params}`) and writes the **same JSON envelope** to stdout — minus the `mermaid` field. The Layer 3 wrapper adds the `mermaid` field back, plus any wiki-specific normalization.

---

## Per-platform attachment/comment scope

For platforms where these concepts are first-class. All actions remain **read-only** — `GET` only, no `POST`/`PATCH`/`PUT`/`DELETE` ever leaves the connector.

### Jira (`@narai/jira-agent-connector`)

| Action | Endpoint | Required params | Output (under `data`) |
|---|---|---|---|
| `get_comments` | `GET /rest/api/3/issue/{issueIdOrKey}/comment?maxResults=N&startAt=M` | `issue_key`, `max_results?` (default 50, max 500) | `{ total, comments: [{id, author, created, updated, body_markdown}] }` |
| `list_attachments` | `GET /rest/api/3/issue/{issueIdOrKey}` (extracts `fields.attachment[]`) | `issue_key` | `{ count, attachments: [{id, filename, mime, size_bytes, author, created, content_url}] }` |
| `get_attachment` | `GET /rest/api/3/attachment/content/{id}` (follow redirect to download) | `attachment_id`, `dest_path?` | `{ id, filename, size_bytes, saved_to }` |

ADF→Markdown conversion: evaluate `@atlaskit/adf-utils` or `jira-adf-to-md`; vendor in-house converter if quality is poor.

### Confluence (`@narai/confluence-agent-connector`)

| Action | Endpoint | Required params | Output |
|---|---|---|---|
| `get_comments` | `GET /wiki/rest/api/content/{id}/child/comment?expand=body.storage,version` | `page_id`, `max_results?` | `{ total, comments: [{id, author, created, updated, body_markdown, parent_comment_id?}] }` |
| `list_attachments` | `GET /wiki/rest/api/content/{id}/child/attachment` | `page_id`, `max_results?` | `{ count, attachments: [{id, filename, mime, size_bytes, version, download_url}] }` |
| `get_attachment` | `GET /wiki/rest/api/content/{attachment_id}/download` (or follow `_links.download`) | `attachment_id`, `dest_path?` | `{ id, filename, size_bytes, saved_to }` |

Storage→Markdown: evaluate `turndown` + custom rules for Confluence macros; vendor in-house if poor.

### GitHub (`@narai/github-agent-connector`)

| Action | Endpoint | Required params | Output |
|---|---|---|---|
| `get_issue_comments` | `GET /repos/{owner}/{repo}/issues/{number}/comments?per_page=N&page=M` | `owner`, `repo`, `issue_number`, `max_results?` | `{ total, comments: [{id, author, created, updated, body_markdown, html_url}] }` |
| `get_pr_review_comments` | `GET /repos/{owner}/{repo}/pulls/{number}/comments` + `GET /repos/{owner}/{repo}/issues/{number}/comments` + `GET /repos/{owner}/{repo}/pulls/{number}/reviews` | `owner`, `repo`, `pull_number` | `{ timeline_comments, review_comments, reviews }` (one round-trip per PR; one envelope) |
| `list_release_assets` | `GET /repos/{owner}/{repo}/releases/{release_id}/assets` (or by tag) | `owner`, `repo`, `release_id` OR `tag` | `{ release: {id, tag, name, html_url}, assets: [{id, name, mime, size_bytes, download_count, browser_download_url}] }` |
| `get_release_asset` | `GET /repos/{owner}/{repo}/releases/assets/{id}` with `Accept: application/octet-stream` | `owner`, `repo`, `asset_id`, `dest_path?` | `{ id, name, size_bytes, saved_to }` |

GitHub bodies are already markdown — no converter needed.

### Notion (`@narai/notion-agent-connector`)

| Action | Endpoint | Required params | Output |
|---|---|---|---|
| `get_comments` | `GET /v1/comments?block_id={id}&page_size=N` | `block_id`, `max_results?` | `{ total, comments: [{id, author, created, body_markdown, parent: {type, id}}] }` |
| `list_attachments` | `GET /v1/blocks/{page_id}/children` (recursive walk for `file`, `image`, `pdf`, `video`, `audio` block types) | `page_id`, `max_depth?` (default 3) | `{ count, attachments: [{block_id, type, filename?, mime?, url, expiry_time?, caption?}] }` |
| `get_attachment` | `GET <url>` (Notion file URLs are pre-signed S3, expire ~1h) | `url`, `dest_path?`, `--url-only?` | Default writes file. With `--url-only`: `{url, expiry_time, filename, mime}` |

Block→Markdown: adopt `notion-to-md` (mature library).

### AWS / GCP

Out of scope. Document this explicitly in each connector's README:

> AWS/GCP integrations are read-only inventory queries. They have no notion of "comments" or "attachments" in the wiki sense.

---

## Layer 1 — Standalone npm package layout

Each `~/src/<service>-agent-connector/`:

```
~/src/<service>-agent-connector/
  package.json                   # @narai/<service>-agent-connector
  tsconfig.json
  vitest.config.ts
  README.md
  src/
    index.ts                     # Public API re-exports
    cli.ts                       # CLI entry point — no mermaid
    lib/
      <service>_client.ts        # Platform HTTP/SDK client
      <service>_actions.ts       # Action handlers
  tests/
    unit/                        # Mocked HTTP
    integration/                 # nock replays of recorded fixtures
    live/                        # Opt-in via TEST_LIVE_<PLATFORM>=1
    fixtures/recorded/
  evals/
```

Each connector declares `@narai/connector-toolkit` as a dependency. SDK clients (e.g. `@notionhq/client`, `@octokit/rest`) go under `optionalDependencies` so users without that platform pay no install cost.

`package.json` template (Notion shown — adapt name + deps per platform):

```json
{
  "name": "@narai/notion-agent-connector",
  "version": "1.0.0",
  "type": "module",
  "engines": { "node": ">=20.0.0" },
  "exports": {
    ".": "./dist/index.js",
    "./cli": "./dist/cli.js"
  },
  "bin": { "notion-agent-connector": "./dist/cli.js" },
  "scripts": {
    "build": "tsc -b",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@narai/connector-toolkit": "^1.0.0",
    "js-yaml": "^4.1.1"
  },
  "optionalDependencies": {
    "@notionhq/client": "^2.2.15"
  },
  "devDependencies": {
    "@types/node": "^20.19.39",
    "typescript": "^5.9.3",
    "vitest": "^3.0.0"
  }
}
```

Per-platform `optionalDependencies`:

| Connector | Optional deps |
|---|---|
| `@narai/aws-agent-connector` | `@aws-sdk/client-lambda`, `@aws-sdk/client-rds`, `@aws-sdk/client-s3`, `@aws-sdk/client-cloudwatch` |
| `@narai/gcp-agent-connector` | `@google-cloud/run`, `@google-cloud/sql-admin`, `@google-cloud/pubsub`, `@google-cloud/logging` |
| `@narai/notion-agent-connector` | `@notionhq/client` |
| `@narai/confluence-agent-connector` | (none — direct REST via `fetch`) |
| `@narai/jira-agent-connector` | (none — direct REST via `fetch`) |
| `@narai/github-agent-connector` | `@octokit/rest` (or direct REST — pick one) |

---

## Layer 2 — Per-connector Claude Code plugin layout

Each `~/src/<service>-agent-plugin/` is a self-contained Claude Code plugin that wraps the matching Layer 1 npm package:

```
~/src/<service>-agent-plugin/
  .claude-plugin/
    plugin.json                  # Manifest
  skills/
    <service>-agent/
      SKILL.md                   # context: fork — runs in a subagent
  commands/
    <service>-agent.md           # /<service>-agent <action> <params>
  hooks/
    hooks.json                   # SessionStart: install npm package once into ${CLAUDE_PLUGIN_DATA}
  bin/
    <service>-agent              # POSIX shim that locates and invokes the CLI
  package.json                   # Just declares @narai/<connector> as a dependency
  README.md
```

### Worked example — `aws-agent-plugin/`

`.claude-plugin/plugin.json`:

```json
{
  "name": "aws-agent-plugin",
  "version": "1.0.0",
  "description": "Read-only AWS connector for Claude Code. Wraps @narai/aws-agent-connector.",
  "author": "narai"
}
```

`skills/aws-agent/SKILL.md`:

```markdown
---
name: aws-agent
description: |
  Use when the user asks about AWS resources — Lambda functions, RDS
  databases, S3 buckets, CloudWatch metrics, or any read-only inventory
  question scoped to an AWS account or region. Read-only, never modifies AWS.
context: fork
---

# AWS Agent Skill

Run the AWS connector CLI to satisfy the request. The CLI is installed via
the SessionStart hook into ${CLAUDE_PLUGIN_DATA}/node_modules and exposed on
PATH as `aws-agent`.

Invoke:
  aws-agent --action <action> --params '<json>'

Supported actions: list_functions, describe_db, list_buckets, get_metrics.
See @narai/aws-agent-connector README for the full action contract and
example envelopes.

Return the resulting JSON envelope verbatim to the orchestrator.
```

`commands/aws-agent.md`:

```markdown
---
description: Run a read-only AWS query via the aws-agent connector
argument-hint: "<action> <params-json>"
---

You have been asked to run an AWS connector query. Invoke the `aws-agent`
skill with the user's $ARGUMENTS as the action and params.
```

`hooks/hooks.json`:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "diff -q \"${CLAUDE_PLUGIN_ROOT}/package.json\" \"${CLAUDE_PLUGIN_DATA}/package.json\" >/dev/null 2>&1 || (mkdir -p \"${CLAUDE_PLUGIN_DATA}\" && cp \"${CLAUDE_PLUGIN_ROOT}/package.json\" \"${CLAUDE_PLUGIN_DATA}/\" && cd \"${CLAUDE_PLUGIN_DATA}\" && npm install --no-audit --no-fund) || rm -f \"${CLAUDE_PLUGIN_DATA}/package.json\""
          }
        ]
      }
    ]
  }
}
```

`bin/aws-agent`:

```bash
#!/usr/bin/env bash
# Locate the npm-installed CLI inside ${CLAUDE_PLUGIN_DATA} and exec it.
exec node "${CLAUDE_PLUGIN_DATA}/node_modules/@narai/aws-agent-connector/dist/cli.js" "$@"
```

`package.json` (just the dep declaration; the SessionStart hook does the install):

```json
{
  "name": "aws-agent-plugin-runtime",
  "version": "1.0.0",
  "private": true,
  "dependencies": {
    "@narai/aws-agent-connector": "^1.0.0"
  }
}
```

The same shape repeats for `gcp-agent-plugin/`, `notion-agent-plugin/`, etc. — only the names, descriptions, and supported actions list change.

---

## Layer 3 — Wrapper template (in doc-wiki)

For each agent, replace `.claude/agents/wiki-<service>-agent/scripts/<service>_fetch.ts` with a thin wrapper modeled on the existing `db_query.ts`. Single template, parametrized per agent:

```typescript
#!/usr/bin/env node
/**
 * <service>_wrapper.ts — Wrapper CLI for the wiki-<service>-agent.
 *
 * Delegates to @narai/<service>-agent-connector (spawned as a subprocess) and
 * augments structural results with a Mermaid diagram. Mermaid generation
 * stays in doc-wiki because it's wiki-specific.
 *
 * Connector CLI is located via (in order):
 *   1. <SERVICE>_AGENT_CLI env var (absolute path to cli.js)
 *   2. ~/.claude/plugins/cache/<service>-agent-plugin/.../node_modules/@narai/<connector>/dist/cli.js
 *      (Layer 2 plugin install — preferred when the user has the plugin)
 *   3. ${CLAUDE_PLUGIN_DATA}/node_modules/@narai/<connector>/dist/cli.js
 *      (when doc-wiki itself is plugin-installed and its own SessionStart hook
 *       has populated ${CLAUDE_PLUGIN_DATA})
 *   4. ~/src/<service>-agent-connector/dist/cli.js (local dev fallback)
 */
import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs";
import { spawn } from "node:child_process";

import { formatGraph, type MermaidBlock } from "../../lib/mermaid_format.js";

const SERVICE = "<service>";                              // e.g. "aws"
const CONNECTOR_PKG = "@narai/<service>-agent-connector"; // e.g. "@narai/aws-agent-connector"
const PLUGIN_NAME = "<service>-agent-plugin";             // e.g. "aws-agent-plugin"

function resolveConnectorCli(): { command: string; args: string[] } | null {
  // 1. Explicit env var override
  const envPath = process.env[`${SERVICE.toUpperCase()}_AGENT_CLI`];
  if (envPath && fs.existsSync(envPath)) return { command: "node", args: [envPath] };

  // 2. Layer 2 plugin install (~/.claude/plugins/cache/<plugin>/...)
  const pluginCache = path.join(os.homedir(), ".claude", "plugins", "cache");
  if (fs.existsSync(pluginCache)) {
    for (const entry of fs.readdirSync(pluginCache)) {
      if (!entry.includes(PLUGIN_NAME)) continue;
      const candidate = path.join(pluginCache, entry, "node_modules", CONNECTOR_PKG, "dist/cli.js");
      if (fs.existsSync(candidate)) return { command: "node", args: [candidate] };
    }
  }

  // 3. doc-wiki's own ${CLAUDE_PLUGIN_DATA}
  const pluginData = process.env["CLAUDE_PLUGIN_DATA"];
  if (pluginData) {
    const candidate = path.join(pluginData, "node_modules", CONNECTOR_PKG, "dist/cli.js");
    if (fs.existsSync(candidate)) return { command: "node", args: [candidate] };
  }

  // 4. Local dev fallback
  const devPath = path.resolve(os.homedir(), `src/${SERVICE}-agent-connector/dist/cli.js`);
  if (fs.existsSync(devPath)) return { command: "node", args: [devPath] };

  return null;
}

// ... spawn subprocess, capture stdout/stderr, parse JSON envelope ...
// ... if action produced structural data, attach `mermaid` field via formatGraph(...) ...
// ... write final envelope to stdout ...
```

Per-agent env var names:

| Wrapper | Env var | Plugin name | Connector npm pkg | Dev fallback |
|---|---|---|---|---|
| wiki-aws-agent | `AWS_AGENT_CLI` | `aws-agent-plugin` | `@narai/aws-agent-connector` | `~/src/aws-agent-connector/dist/cli.js` |
| wiki-gcp-agent | `GCP_AGENT_CLI` | `gcp-agent-plugin` | `@narai/gcp-agent-connector` | `~/src/gcp-agent-connector/dist/cli.js` |
| wiki-notion-agent | `NOTION_AGENT_CLI` | `notion-agent-plugin` | `@narai/notion-agent-connector` | `~/src/notion-agent-connector/dist/cli.js` |
| wiki-confluence-agent | `CONFLUENCE_AGENT_CLI` | `confluence-agent-plugin` | `@narai/confluence-agent-connector` | `~/src/confluence-agent-connector/dist/cli.js` |
| wiki-jira-agent | `JIRA_AGENT_CLI` | `jira-agent-plugin` | `@narai/jira-agent-connector` | `~/src/jira-agent-connector/dist/cli.js` |
| wiki-github-agent | `GITHUB_AGENT_CLI` | `github-agent-plugin` | `@narai/github-agent-connector` | `~/src/github-agent-connector/dist/cli.js` |

The wrapper's `AGENT.md` keeps the existing frontmatter (name, source_schemes, source_url_patterns, invocation_template) and adds an "Architecture" section identical in shape to `wiki-db-agent/AGENT.md`'s, with the 4-step resolver enumerated.

doc-wiki's own `package.json` declares each `@narai/<service>-agent-connector` as an `optionalDependency` so a `git clone + npm install` workflow keeps working without forcing every platform on every user.

---

## Step-by-step plan

### Phase 3a — Build `~/src/connector-toolkit/`

Before any connector. Extract the shared helpers into a standalone repo:

```
~/src/connector-toolkit/
  package.json              # @narai/connector-toolkit
  tsconfig.json
  vitest.config.ts
  README.md
  src/
    index.ts
    agent_cli.ts            # Was _agent_cli.ts in doc-wiki
    fetch_helper.ts
    security_check.ts
    parse_config.ts
    credential_providers/
      index.ts, env_var.ts, file.ts, keychain.ts, cloud_secrets.ts
  tests/
```

Verify: `npm install && npm run build && npm test` against the moved test suite — all helper tests pass. Bump doc-wiki itself to consume `@narai/connector-toolkit` (vendored copies in `.claude/agents/lib/` removed; imports point at the package). `npm test` in doc-wiki must stay green.

### Phase 3b — Per-platform vertical slice

For each platform in this order — `aws`, `gcp`, `notion`, `confluence`, `jira`, `github` — execute all six sub-steps before starting the next platform. Each platform delivers end-to-end value (npm package + Layer 2 plugin + Layer 3 doc-wiki integration) before the next one begins.

**Sub-step 1: scaffold Layer 1 npm package.** Create `~/src/<service>-agent-connector/` per the Layer 1 layout. `package.json` declares `@narai/connector-toolkit` as a dependency and adds platform SDK packages as `optionalDependencies`. Verify: `npm install && npm run build` succeed.

**Sub-step 2: copy + adapt code into Layer 1.** Copy `scripts/<service>_fetch.ts` → `src/cli.ts` (strip Mermaid). Copy `scripts/lib/*.ts` → `src/lib/`. Replace previously-vendored helpers with `import { ... } from "@narai/connector-toolkit"`. Move tests to `tests/unit/`, add `tests/integration/` (nock replays) and `tests/live/` (gated by `TEST_LIVE_<PLATFORM>=1`). For Markdown body conversion, evaluate third-party (`notion-to-md`, `turndown`, `@atlaskit/adf-utils` / `jira-adf-to-md`); vendor in-house only when third-party quality is unacceptable. Verify: `npm test && npm run typecheck` in the connector repo pass.

**Sub-step 3: add comment/attachment actions.** _Skip for AWS/GCP_ (mark "no-op per plan"). For Jira/Confluence/Notion/GitHub: implement the exact endpoints + output shapes from the per-platform scope section. Each action gets a unit test (mocked), an integration test (nock replay of a recorded fixture), and an opt-in live test. Add to `VALID_ACTIONS`. For `get_attachment`: validate `dest_path` via `securityCheck.pathContainment`, stream to disk, default cap **100 MB**, raisable via `--max-size-mb` up to **500 MB**. For Notion specifically: `--url-only` returns `{url, expiry_time, filename, mime}` instead of downloading.

**Sub-step 4: scaffold Layer 2 plugin.** Create `~/src/<service>-agent-plugin/` per the Layer 2 layout. Initialize `.claude-plugin/plugin.json`, the runtime `package.json` declaring `@narai/<service>-agent-connector` as a dep, the `bin/<service>-agent` shim, and the `hooks/hooks.json` SessionStart entry (use the documented one-liner verbatim). Verify: `node -e "require('./.claude-plugin/plugin.json')"` parses; `bash bin/<service>-agent --help` (with `CLAUDE_PLUGIN_DATA` pointing at a temp dir where the npm package is installed) returns a help screen.

**Sub-step 5: add SKILL + slash command to Layer 2 plugin.** Author `skills/<service>-agent/SKILL.md` with `context: fork` and a description that triggers on platform-specific queries (the SKILL must NOT mention doc-wiki — it stands alone). Author `commands/<service>-agent.md` with the `argument-hint` and a single short prompt that delegates to the skill. Smoke-test by installing the plugin into a scratch Claude Code workspace and confirming the slash command appears in autocomplete.

**Sub-step 6: replace doc-wiki agent script with Layer 3 wrapper.** Replace `.claude/agents/wiki-<service>-agent/scripts/<service>_fetch.ts` with `<service>_wrapper.ts` from the Layer 3 template (4-step resolver). Add `@narai/<service>-agent-connector` to doc-wiki's `package.json` as an `optionalDependency`. Update `wiki-<service>-agent/AGENT.md` with the new "Architecture" section (4-step resolver). Bump `version` patch (e.g. `1.0.1`); add a minor bump on top if new comment/attachment actions are listed in the AGENT.md examples. Add a wrapper smoke test that mocks the spawned subprocess. Verify: `npm test && npm run typecheck` in doc-wiki pass.

After Sub-step 6, run an **end-to-end smoke** for the platform: with the Layer 1 npm package built locally, the Layer 2 plugin installed into a scratch Claude Code workspace, and doc-wiki's wrapper exercising it, confirm a real (or stubbed) action returns a valid envelope with the `mermaid` field attached.

Then move on to the next platform.

### Phase 3c — Finalization

**Step F1: `wiki.config.yaml` schema + `parse_config.ts`.** Add an optional per-agent `connector_path` override (consulted as a step 0 in the wrapper resolver). Add tests. Verify: `npm test` in doc-wiki passes; `node .claude/agents/lib/source_registry.js list` still lists 10 agents.

**Step F2: docs refresh.** Update `docs/architecture-sources-and-agents.md` §3 (per-platform) and §5 (db-agent pattern) to describe the 3-layer model; add a new §11.5 listing all 7 npm packages and 7 plugins. Update root `CLAUDE.md` to add the new env vars (`AWS_AGENT_CLI` ... `GITHUB_AGENT_CLI`) under "Architecture contracts". Verify: docs lint passes; cited paths exist.

**Step F3: source registry verification + final test sweep.** `node .claude/agents/lib/source_registry.js list` shows 10 agents. `npm test` in doc-wiki: 1025+ passing, 5 skipped (live-DB). Each connector repo `npm test` green. Each plugin loads in a scratch Claude Code workspace.

---

## Reuse outside doc-wiki

A third party can consume any single connector without doc-wiki:

- **Library / CLI use:** `npm install @narai/aws-agent-connector` and call the CLI from any tool. Output is the same JSON envelope the wrapper consumes.
- **Claude Code use:** `/plugin install <marketplace>/aws-agent-plugin` and use the `/aws-agent` slash command. The plugin's SessionStart hook installs the npm package transparently. No doc-wiki, no Mermaid, no wiki coupling.
- **Both:** users who install the Layer 2 plugin _and_ doc-wiki get the wiki-side Mermaid decoration on top of the same connector via Layer 3's resolver step 2.

The Layer 1 packages and Layer 2 plugins must not import from doc-wiki, must not reference doc-wiki concepts (sources, edges, summaries) in their docs, and must be testable in isolation.

---

## Cross-cutting decisions (confirmed)

1. **Toolkit timing — extract first as Phase 3a.** All connectors depend on `@narai/connector-toolkit` from day one.
2. **Publishing — dev fallback only initially.** No npm publish in this phase. Once all 7 connectors + 6 plugins are stable, publish them together as a Phase 4.
3. **Repo organization — three repos per platform** (`connector-toolkit` is shared): `<service>-agent-connector` (npm), `<service>-agent-plugin` (Claude Code plugin). Plus `doc-wiki` itself. Each repo has its own git history. No monorepo.
4. **Wrapper version — stay at 1.x.** Patch bump for the wrapperisation; minor bump when listing new comment/attachment actions.
5. **Notion file expiration — download immediately by default; `--url-only` flag for advanced callers.**
6. **GitHub PR comment surfaces — single action returning all three** (`{timeline_comments, review_comments, reviews}`).
7. **Attachment size cap — default 100 MB, `--max-size-mb` up to 500 MB, stream to disk.**
8. **Markdown converters — third-party where good options exist; reuse our implementation otherwise.**
9. **Rollout — per-platform vertical slice after Phase 3a.** Build `connector-toolkit` first; then per-platform aws → gcp → notion → confluence → jira → github, all 6 sub-steps for each platform before the next starts.
10. **Auto-install — handled by SessionStart hooks, not by the wrappers.**
    - Layer 2 plugin's SessionStart hook installs the matching `@narai/<connector>` into `${CLAUDE_PLUGIN_DATA}` on first session.
    - Layer 3 wrapper's resolver finds the connector via the Layer 2 plugin cache OR (when doc-wiki itself is plugin-installed) via doc-wiki's own SessionStart hook into `${CLAUDE_PLUGIN_DATA}`.
    - Wrappers never invoke `npm install` themselves.
11. **Test fixtures — all three layers** for new actions: mocked unit + nock-recorded integration + opt-in live (`TEST_LIVE_<PLATFORM>=1`).
12. **`wiki-orm-agent` extraction — deferred.** Stays as-is in doc-wiki for this phase.
13. **`db-agent-connector` retrofit — deferred to Phase 3.5.** Currently single-layer (npm only). Once one new connector validates the 3-layer pattern end-to-end, retrofit `db-agent-connector` to fit by adding a `db-agent-plugin` (Layer 2).

---

## Open follow-ups (not in this phase)

- npm publish under `@narai/*` and Claude Code marketplace listing for the 7 plugins (Phase 4).
- Migrate `db-agent-connector` to the 3-layer pattern (Phase 3.5).
- Update `docs/architecture-sources-and-agents.md` and root `CLAUDE.md` to describe the 3-layer model project-wide.

---

## Estimated effort

Per platform: ~1.5 days for AWS/GCP (no new actions, but Layer 2 plugin scaffold is new), ~3 days for Notion/Jira/Confluence (3 new actions each + Layer 2), ~3.5 days for GitHub. Toolkit: ~1.5 days. Finalization: ~1.5 days. Total **~17 person-days**. Each platform is an independent vertical slice — easy to land per-platform and easy to course-correct after the first one ships.
