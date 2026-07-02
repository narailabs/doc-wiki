# doc-wiki

Documentation wiki generator and maintainer. Runs entirely inside Claude Code as skills + agents + TypeScript helper scripts.

## Documentation

The public-facing documentation lives under [`docs/`](docs/). Start there for installation, usage, and architecture details.

| Audience | Read |
|---|---|
| Brand new — installing | [`README.md`](README.md), [`docs/getting-started.md`](docs/getting-started.md) |
| Operator — using the commands | [`docs/commands.md`](docs/commands.md), [`docs/configuration.md`](docs/configuration.md), [`docs/troubleshooting.md`](docs/troubleshooting.md) |
| Contributor — modifying internals | [`docs/internals/architecture.md`](docs/internals/architecture.md), [`docs/internals/connectors-api.md`](docs/internals/connectors-api.md), [`CONTRIBUTING.md`](CONTRIBUTING.md) |

This file (`CLAUDE.md`) is the project-memory layer that Claude Code loads automatically; the sections below are an architecture summary for the orchestrator. The full architecture doc with Mermaid diagrams is at [`docs/internals/architecture.md`](docs/internals/architecture.md).

## Quickstart

Three slash commands take a new repo from zero to a working wiki:

```
/doc-wiki:init         # scaffold + onboard + (optionally) chain /doc-wiki:atlas
/doc-wiki:ingest <src> # fetch a source, compile, link, diagram, index
/doc-wiki:query <q>    # search the wiki, optionally save the answer as a page
```

`/doc-wiki:init` Phase 3 (onboarding) walks the user through configuring `narai-primitives`'s `~/.connectors/config.yaml` from `.connectors/config.example.yaml` (in this repo). After that, every `/doc-wiki:ingest <jira-url>`, `/doc-wiki:ingest <github-repo>`, etc. routes through `gather()` to the right connector — no per-service setup needed.

## Architecture

- **Main skill:** `skills/doc-wiki/SKILL.md` — orchestrates all `/doc-wiki:*` commands
- **Slash-command wrappers:** `commands/*.md` — 8 thin wrappers so `/doc-wiki:init`, `/doc-wiki:atlas`, `/doc-wiki:ingest`, `/doc-wiki:query`, `/doc-wiki:lint`, `/doc-wiki:edit`, `/doc-wiki:unarchive`, `/doc-wiki:stats` appear in Claude Code's slash-command autocomplete and route into the skill
- **Source-fetch dispatch:** `/doc-wiki:ingest` step 7 calls `gather()` from `narai-primitives`, which plans and spawns the bundled connector CLIs in parallel. The wiki-side Mermaid augmentation runs on the raw envelopes via `agents/lib/mermaid_augment.ts`. There is **one path**: gather → applyMermaid. The legacy `wiki-<svc>-agent` subagents + their per-service wrappers were decommissioned — their CLI-resolution and Mermaid responsibilities are now wholly owned by the hub and `mermaid_augment.ts`.
- **No standalone CLI** — all LLM calls go through Claude Code's session
- **Runtime:** Node 20. All scripts are TypeScript; `npm run build` emits sibling `.js` files that are invoked with `node`.

### Slash commands (8) — `commands/`

Thin wrappers so each documented `/doc-wiki:*` subcommand is discoverable in Claude Code's slash-command autocomplete. Each wrapper invokes the `doc-wiki` skill with the matching subcommand and passes `$ARGUMENTS` through. Files: `init.md`, `atlas.md`, `ingest.md`, `query.md`, `lint.md`, `edit.md`, `unarchive.md`, `stats.md`. (`init` covers setup + optional atlas chain (replacing the old standalone `onboard`); `ingest` includes `--refresh` (replacing the old `refresh`); `query` includes `--promote`/`--review` (replacing the old `promote`); `edit` replaces the old `fix`; `unarchive` restores a page from `wiki/_archive/`. `/doc-wiki:atlas` is a meta-orchestrator over `/doc-wiki:ingest` that documents the entire codebase in one phased pass with topic discovery, cost estimation, and existing-content validation; shortest-path between concepts is path mode of `/doc-wiki:query` — `--from <a> --to <b>` shells out to `graph_ops.js path`.)

Pages atlas detects as orphaned (sources removed from code) are moved to `wiki/_archive/` and excluded from the main wiki surface. Restore via `/doc-wiki:unarchive <slug>`.

### TypeScript scripts (24) — `skills/doc-wiki/scripts/`

Deterministic operations: scaffolding, parsing, graph ops, lint, multimodal extraction, checkpointing. (Security primitives — URL/path/label validation — moved into `narai-primitives/toolkit`.)

| Script | Purpose |
|--------|---------|
| `init_wiki.ts` | Scaffold wiki directory structure and config |
| `apply_config.ts` | Translate `wiki.config.yaml` blocks (currently `credentials`) into live state by registering providers from `narai-primitives/credentials` |
| `event_logger.ts` | Append structured events to `events.jsonl` |
| `graph_ops.ts` | Relationship graph queries (paths, clusters, orphans) |
| `lint_checks.ts` | Frontmatter and link validation |
| `quality_score.ts` | Per-page and aggregate quality scoring |
| `cache_manager.ts` | Content-hash cache for incremental processing |
| `checkpoint.ts` | Resume mechanism for long-running batch ops; atomic JSON state at `<wikiRoot>/.wiki-checkpoint.json`, keyed per operation |
| `daily_summary.ts` | Generate daily digest of wiki changes |
| `extract_binary.ts` | Extract text from binary files (PDF, DOCX, etc.) |
| `extract_multimodal.ts` | Optional extraction for images, audio/video, YouTube; gated by `ecosystem.multimodal.enabled`; degrades gracefully when `faster-whisper` / `yt-dlp` are off-PATH |
| `mermaid_lint.ts` | Validate Mermaid diagram syntax |
| `mermaid_inject.ts` | Splice agent-emitted Mermaid blocks into compiled pages between idempotent `<!-- wiki-mermaid: ... -->` markers (ingest step 9) |
| `summaries_rebuild.ts` | Deterministic regeneration of `wiki/summaries.md` (progressive-disclosure index loaded first by `/doc-wiki:query`); preserves content outside `wiki-managed: summaries` markers |
| `banlist.ts` | Anti-repetition memory harvester; aggregates deprecated claims with `failure_reason` into a markdown section spliced into `summaries.md` |
| `how_to_go_deeper.ts` | Auto-generate the trailing "How to Go Deeper" section on externally-sourced pages (uses `source_registry`'s `BUILTIN_PATTERNS` + custom config) |
| `hook_installer.ts` | Idempotent installer for PreToolUse hook configs across Claude Code, Codex, Cursor, and Aider |
| `atlas_orchestrator.ts` | `/doc-wiki:atlas` state detection, plan-snapshot persistence, cost estimation |
| `atlas_gitlog.ts` | `git log --since` parser; classifies changed paths as stale / uncovered / unrelated against atlas-page sources and current topic list |
| `atlas_validate.ts` | `(page-hash, source-hash)` cache for atlas semantic validation; structural-check wrapper over `lint_checks.ts` |
| `_cli_args.ts` | Shared `--flag value` / `--flag=value` / `-h` argv parser for the wiki scripts |
| `_frontmatter.ts` | Canonical YAML frontmatter parser shared by `lint_checks.ts` and `quality_score.ts` |
| `_optional.ts` | `importOptional()` and `isBinaryOnPath()` helpers for graceful degradation when an optional npm dep or external CLI is missing |
| `_wiki_fs.ts` | Shared recursive `*.md` walker rooted at `<wikiRoot>/wiki/`, sorted lexicographically |

### Agents (4) — `agents/`

External-source fetching is handled by the connectors bundled inside `narai-primitives`, dispatched through its `gather()` planner — there are no per-service subagents in doc-wiki. The remaining agents do wiki-specific derivation that has nothing to do with the connector workspace:

| Agent | Purpose |
|-------|---------|
| `wiki-claude-md-agent` | Generate project `CLAUDE.md` from wiki pages |
| `wiki-readme-agent` | Sync repo-root `README.md` quickstart block against `wiki/getting-started.md`; dispatched alongside `wiki-claude-md-agent` in atlas Phase 8 |
| `wiki-mermaid-agent` | Generate Mermaid architecture diagrams |
| `wiki-orm-agent` | ORM model detection and entity-to-table mapping (uses `wiki_db` to cross-validate schemas) |

### Shared libraries (2) — `agents/lib/`

| Library | Purpose |
|---------|---------|
| `wiki_db` | Connection / driver / policy code reused by `wiki-orm-agent` for schema cross-validation. Originally extracted from the now-deleted `wiki-db-agent` wrapper; the connector-side policy gate lives in `@narai/db-agent-connector`. |
| `wiki_orm` | ORM mapper with 7 profiles: SQLAlchemy, Django, JPA, Prisma, TypeORM, ActiveRecord, Entity Framework |

ORM profile definitions ship as YAML files under `agents/lib/wiki_orm/profiles/*.yaml` and are loaded by the TypeScript mapper at runtime.

Standalone helpers still live at `agents/lib/` (flat files, no subdirectory):

| Helper | Purpose |
|--------|---------|
| `source_registry.ts` | Source-to-connector matching (URL/scheme → connector ID). Builtin patterns are a static list of 9 connectors (jira, confluence, github, gitlab, notion, linear, aws, gcp, db). Custom patterns load from `wiki.config.yaml` `ecosystem.agents.custom`. Used by `how_to_go_deeper.ts` (ingest step 10) for cross-link classification — never dispatches connector calls. |
| `parse_config.ts` | Read and validate `wiki.config.yaml` (shared with skills) |
| `mermaid_format.ts` | Mermaid diagram formatting utilities |
| `mermaid_augment.ts` | Apply wiki-specific `mermaid: { type, title, code }` blocks on top of raw `DispatchResult` envelopes returned by `narai-primitives`'s `gather()`. Used by `/doc-wiki:ingest` step 7. Single decoration site for the 7 structural connectors (aws, gcp, jira, confluence, notion, github, db); gitlab/linear results route through unchanged (no Mermaid decorator yet). |
| `atlas_synthesize.ts` | Read-only input assembly for `/doc-wiki:atlas` Phase 7 (global synthesis). Three subcommands — `overview` (concatenated topic architecture pages + per-facet TL;DRs), `integrations` (api pages + external-service mentions + connector config), `deploy` (Dockerfile, compose, workflows, terraform). |
| `atlas_inventory.ts` | Pre-Phase-2 code-inventory manifest for `/doc-wiki:atlas` — emits project metadata, ORM entities, REST endpoints, and code-client callsites to `<wikiRoot>/outputs/atlas/<runId>/code-inventory.json`; consumed by Phase 8 gap report. |
| `repo_walker.ts` | Shared bounded source-file walker with a tuned ignore-list; lifted from `wiki-orm-agent` so atlas inventory and future consumers share one walker. |

REST framework profiles (used by `atlas_inventory.ts` for endpoint detection) ship as YAML under `agents/lib/rest_profiles/*.yaml` — 18 profiles spanning Node (express, fastify, koa, hono), Python (django, fastapi, flask), JVM (spring), .NET (aspnet), Ruby (rails), PHP (laravel, slim), Go (gin, echo), Rust (actix, rocket), Elixir (phoenix), and Swift (vapor).

Vendor-neutral connector code ships as a single npm package and is consumed directly:

| Package | Purpose |
|---------|---------|
| `narai-primitives` | Bundled hub + toolkit + config + 9 connectors (db, github, gitlab, jira, confluence, notion, linear, aws, gcp) + credential providers. Default export is the hub: `gather({ prompt, consumer })` plans and parallel-dispatches read-only connector calls. Drives `/doc-wiki:ingest` step 7. Sub-paths: `narai-primitives/toolkit` (CLI/fetch/security primitives — `parseAgentArgs`, `fetchWithCaps`, `validateUrl`, `checkPathContainment`, `sanitizeLabel`), `narai-primitives/config` (`loadResolvedConfig`), `narai-primitives/credentials` (env-var / keychain / file / cloud-secret-manager providers — `resolveSecret`, `registerProvider`, `CredentialResolver`), and per-connector entries like `narai-primitives/db`. Replaces the nine pre-2.1 `@narai/*` packages (8 connector + toolkit + config + hub from v2.0, plus `@narai/credential-providers` absorbed in v2.1), all of which are deprecated on npm. |

### Reference docs (5) — `skills/doc-wiki/references/`

| Document | Topic |
|----------|-------|
| `autonomy.md` | Agent autonomy levels and escalation |
| `code-locality.md` | Code-aware wiki page placement |
| `compilation.md` | Wiki compilation and build pipeline |
| `operations.md` | Operational runbooks and maintenance |
| `quality.md` | Quality scoring rubric and thresholds |

### Multi-platform wrappers

The wiki skill is accessible from multiple AI coding tools via wrapper files:

| File | Platform |
|------|----------|
| `AGENTS.md` | Codex / OpenAI agents |
| `GEMINI.md` | Gemini / Google AI |
| `.cursor/rules/doc-wiki.mdc` | Cursor IDE |
| `.aider/conventions.md` | Aider |

## Design reference

The public-facing documentation tree under [`docs/`](docs/) is the canonical reference for architecture, usage, and configuration. Start at [`docs/README.md`](docs/README.md) for an audience-routing index.

## Setup

Requires Node 20. Install and build once:

```bash
npm install
npm run build
```

## Testing

All tests use Vitest.

| Suite | Command |
|-------|---------|
| Wiki scripts | `npx vitest run skills/doc-wiki/scripts/tests/` |
| wiki_db library | `npx vitest run agents/lib/wiki_db/tests/` |
| ORM mapper | `npx vitest run agents/lib/wiki_orm/tests/` |
| CLAUDE.md gen | `npx vitest run agents/wiki-claude-md-agent/scripts/tests/` |
| Mermaid gen | `npx vitest run agents/wiki-mermaid-agent/scripts/tests/` |
| **Full suite** | `npm test` (alias for `vitest run`) |
| Typecheck | `npm run typecheck` |
| Build | `npm run build` |
| Skills/agents | `/skill-creator` evals |

Current status: **1130 tests passed, 5 skipped (live-DB integration tests, gated behind `TEST_LIVE_*` env vars)**.

## Key conventions

- Standard markdown links for all wiki navigation (NOT wikilinks)
- `edges.jsonl` for typed relationship metadata (supports, contradicts, extends, supersedes)
- Provenance tags on every edge (EXTRACTED / INFERRED / AMBIGUOUS)
- Content-only concept tags (no structural/temporal/metadata tags)
- Security Baseline: URL validation, path containment, size/timeout caps, label sanitization
- Guard-rail policy for database agent: ALLOW / DENY / ESCALATE / PRESENT_ONLY
- No Python in this repo. To verify: `find . -name '*.py' -not -path './node_modules/*' -not -path './wiki-workspace/*' -not -path './.worktrees/*/node_modules/*'` should return only the ORM extractor fixture source files under `agents/lib/wiki_orm/tests/fixtures/{sqlalchemy,django}/` (input data read as text by TypeScript tests).

## Architecture contracts

Load-bearing invariants implementers must respect:

- **Database drivers implement `executeReadAsync(conn, sql, params, maxRows, timeoutMs): Promise<ExecuteReadResult>`.** There is no sync `execute` path. Sync drivers (e.g. SQLite's `executeRead`) are adapted at the call site via `adaptDriver` (used by `wiki-orm-agent` and the `wiki_db` library tests).
- **`getConnection(envName)` is async.** Callers must `await` it. `release` and `shutdown` use identity-based lookup on the awaited handle.
- **Single source-fetch path through `gather()`.** `/doc-wiki:ingest` step 7 calls `gather()` from `narai-primitives`; doc-wiki does not maintain per-service subagents or wrappers. The hub owns CLI resolution, parallel dispatch, and per-step error isolation; `mermaid_augment.ts` owns wiki-specific decoration.
- **Credential resolution uses the `narai-primitives/credentials` subpath.** Import `resolveSecret`, `registerProvider`, and provider classes from `narai-primitives/credentials` (absorbed into the bundle in v2.1). Connectors load their own credentials inside the connector process — doc-wiki does not pass credentials into `gather()`.
- **ORM profile patterns are validated at load time.** `loadProfile` compiles every regex-valued pattern; a bad pattern throws `ProfileValueError` with the file path and offending pattern.
- **Source-to-connector matching is data-driven.** `lookupBySource()` from `agents/lib/source_registry.ts` reads a static `BUILTIN_PATTERNS` list (one entry per connector bundled in `narai-primitives`). Custom patterns load via `ecosystem.agents.custom` in `wiki.config.yaml` — classification call sites bootstrap through `initRegistryFromConfig()`, with the wiki root threaded from the caller (`how_to_go_deeper.js --wiki-root`, atlas's `wikiConfigPath` option) and a cwd probe (`./wiki.config.yaml`, then `./wiki/wiki.config.yaml`) as fallback; malformed entries are skipped with a warning, and no code changes are needed to add a new connector mapping. `lookupBySource` never dispatches a connector; it only classifies sources for `how_to_go_deeper.ts` and `external_sources.ts`.

<!-- wiki-managed: reference start -->
## Reference

### Documentation index

- [`README.md`](README.md) — repo entry point + quickstart
- [`docs/README.md`](docs/README.md) — public-facing documentation index
- [`docs/getting-started.md`](docs/getting-started.md) — first-run walkthrough
- [`docs/internals/architecture.md`](docs/internals/architecture.md) — full architecture overview

### Coding agent configuration registry

Per-tool configuration lives at the repo root in this very file family:

| Tool | Config file |
|---|---|
| Claude Code | [`CLAUDE.md`](CLAUDE.md) |
| Codex / OpenAI agents | [`AGENTS.md`](AGENTS.md) |
| Gemini | [`GEMINI.md`](GEMINI.md) |
| Cursor | [`.cursor/rules/doc-wiki.mdc`](.cursor/rules/doc-wiki.mdc) |
| Aider | [`.aider/conventions.md`](.aider/conventions.md) |

### Other references

- [`docs/atlas.md`](docs/atlas.md) — `/doc-wiki:atlas` reference
- [`docs/commands.md`](docs/commands.md) — every `/doc-wiki:*` slash command
- [`docs/configuration.md`](docs/configuration.md) — `wiki.config.yaml` schema
- [`docs/troubleshooting.md`](docs/troubleshooting.md) — symptom → cause → fix
- [`docs/connectors.md`](docs/connectors.md) — connector setup
<!-- wiki-managed: reference end -->
