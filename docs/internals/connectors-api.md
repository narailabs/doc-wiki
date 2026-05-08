# `narai-primitives` API reference

Internals reference for the connector framework that doc-wiki delegates to. **This is contributor / integrator territory** — if you only want to *use* the seven built-in connectors with doc-wiki, read [`../connectors.md`](../connectors.md) instead.

This doc covers:

- The `gather()` planner-dispatcher signature and lifecycle.
- The `narai-primitives/toolkit` building blocks (`createConnector()`, security helpers, CLI helpers).
- The `narai-primitives/config` loader (`loadResolvedConfig()`, `ResolvedConfig` shape).
- The `narai-primitives/credentials` public API.
- How wiki-side decoration (`mermaid_augment.ts`) sits on top of `gather()` results.
- How to contribute a new built-in connector upstream.

## Table of contents

- [Why `narai-primitives`](#why-narai-primitives)
- [Package map](#package-map)
- [`gather()` — the planning hub](#gather--the-planning-hub)
- [The toolkit](#the-toolkit)
- [The config module](#the-config-module)
- [Credential providers — public API](#credential-providers--public-api)
- [Wiki-side decoration: `mermaid_augment.ts`](#wiki-side-decoration-mermaid_augmentts)
- [Contributing a built-in connector](#contributing-a-built-in-connector)

## Why `narai-primitives`

Pre-2.0, doc-wiki depended on eight separate `@narai/*` packages: `connector-hub`, `connector-toolkit`, `connector-config`, and one `*-agent-connector` package per service (`db`, `github`, `jira`, `confluence`, `notion`, `aws`, `gcp`), plus `@narai/credential-providers` as a ninth. Maintaining nine packages with synchronized release cadences was a tax on every change.

With `narai-primitives@2.0.0`, the eight connector packages were bundled into a single deliverable. With `narai-primitives@2.1.0`, `@narai/credential-providers` was absorbed too — its API is now reachable at the `narai-primitives/credentials` subpath. All nine legacy packages are deprecated on npm.

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
| `narai-primitives/credentials` | `resolveSecret`, `registerProvider`, provider classes |
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

The caller sees `out.results[i].error.code` and decides whether to fail the operation or carry on with partial results. doc-wiki's `/doc-wiki:ingest` carries on with whatever envelopes succeeded.

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

For the full schema (every key, default, and example), see [`../configuration.md`](../configuration.md).

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

## Credential providers — public API

The credential-resolution layer ships as the `narai-primitives/credentials` subpath (absorbed into the bundle in v2.1; previously published as the standalone `@narai/credential-providers` package, now deprecated on npm). doc-wiki imports it directly from the `narai-primitives` dependency it already declares — no separate install.

For the **user-facing** credential reference grammar (`env:` / `keychain:` / `file:` / `cloud:aws-secret/` / `cloud:gcp-secret/`) and the resolution order, see [`../configuration.md`](../configuration.md#credential-reference-grammar).

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
} from "narai-primitives/credentials";

// Resolve a single ref:
const token = await resolveSecret("env:GITHUB_TOKEN");

// Register a custom provider:
registerProvider("vault", new MyVaultProvider());
```

### Where resolution happens

Crucially, credential resolution happens **inside the connector subprocess**, not in doc-wiki. The hub passes the connector its config slice via `NARAI_CONFIG_BLOB` (a JSON-stringified env var); the connector then calls `resolveSecret()` for each ref it needs.

Doc-wiki itself never sees a cleartext credential. Even if you log `gather()` results, you'll see API responses, not tokens.

This is invariant **#4** in [the architecture contracts](architecture.md#architecture-contracts).

## Wiki-side decoration: `mermaid_augment.ts`

After `gather()` returns, doc-wiki runs the results through [`mermaid_augment.ts`](../../agents/lib/mermaid_augment.ts). This is the single decoration site for all 7 connectors — it inspects each `DispatchResult.envelope`, recognizes connector-specific shapes (Jira issues, GitHub PRs, schema info from `db`, etc.), and adds a `mermaid: { type, title, code }` field with a wiki-ready Mermaid block.

The wiki page compilation step then splices these blocks into the page (idempotently, via `mermaid_inject.ts`'s `<!-- wiki-mermaid: <title> start/end -->` markers).

If you add a new connector and want the wiki to generate a Mermaid diagram from its envelopes, edit `mermaid_augment.ts` — never the connector itself. The toolkit and connectors stay vendor-neutral; wiki-specific decoration lives at the wiki edge.

This is invariant **#3** in [the architecture contracts](architecture.md#architecture-contracts): one source-fetch path through `gather()`, one decoration site at `mermaid_augment.ts`.

## Contributing a built-in connector

If your connector is broadly useful (would benefit multiple Narailabs tools), open a pull request against [narailabs/narai-primitives](https://github.com/narailabs/narai-primitives). The repository's [`CONTRIBUTING.md`](https://github.com/narailabs/narai-primitives/blob/main/CONTRIBUTING.md) walks through the structure: drop your connector under `src/connectors/<name>/`, add zod schemas for actions, write tests under `tests/connectors/<name>/`, register a CLI binary in the umbrella dispatcher, and add an entry to the package's `exports` map.

doc-wiki's only hook into a new built-in is its entry in `BUILTIN_PATTERNS` in [`source_registry.ts`](../../agents/lib/source_registry.ts) — add it there too, so `/doc-wiki:ingest` routes the right URLs through the new connector.

For project-local connectors (a SaaS / API / CLI that isn't broadly useful), use the `/create-connector` skill instead — see [`../connectors.md`](../connectors.md#adding-a-custom-local-connector).
