# doc-wiki -- Documentation Wiki Skill (Gemini)

This project has a documentation wiki skill that generates and maintains structured documentation from code, external sources, and manual input. All wiki operations are driven by TypeScript scripts (compiled to JavaScript, invoked via `node`) and sub-agents.

## Documentation

Public-facing docs live in [`docs/`](docs/). For Gemini users:

- [`docs/getting-started.md`](docs/getting-started.md) — install + first ingest
- [`docs/commands.md`](docs/commands.md) — reference for all 7 `/doc-wiki:*` commands
- [`docs/configuration.md`](docs/configuration.md) — `wiki.config.yaml` and `.connectors/config.yaml` schemas
- [`docs/internals/architecture.md`](docs/internals/architecture.md) — full architecture with Mermaid diagrams
- [`docs/connectors.md`](docs/connectors.md) — the `narai-primitives` stack
- [`docs/troubleshooting.md`](docs/troubleshooting.md) — common failures

## Before You Search

Before searching the codebase with grep, find, or glob, check if the wiki already has the answer. Run wiki-query first:

```bash
node skills/doc-wiki/scripts/parse_config.js --config wiki.config.yaml
```

Then search `wiki/summaries.md` for relevant pages.

## Commands

### /doc-wiki:init -- Bootstrap a wiki

Create the directory scaffold and initial configuration.

```bash
node skills/doc-wiki/scripts/init_wiki.js --path <wiki-root> --domain "<domain>" --name "<wiki-name>"
```

### /doc-wiki:atlas — Full application documentation

Generate or regenerate full application documentation in one phased pass. Atlas discovers topics from the codebase, estimates cost, validates existing content, and drives the underlying `/doc-wiki:ingest` pipeline across the discovered facet set (architecture, data-model, environments, api, operations). Use for first-run documentation runs or large refreshes. Direct invocation: `/doc-wiki:atlas`. Also reachable via the post-onboarding prompt at the end of `/doc-wiki:init`.

### /doc-wiki:ingest -- Fetch, extract, compile

Ingest a source (file, URL, folder, pasted text) into the wiki.

```bash
# Check cache first
node skills/doc-wiki/scripts/cache_manager.js check --path <source-path> --cache-dir <wiki-root>/.wiki-cache/

# Security check for URLs
node skills/doc-wiki/scripts/security_check.js --url <url>

# Extract binary files
node skills/doc-wiki/scripts/extract_binary.js --input <file> --output <raw-dir>/extracted/

# Log the operation
node skills/doc-wiki/scripts/event_logger.js --op ingest --source <source> --wiki-root <wiki-root> --details '<json>'
```

### /doc-wiki:query -- Summary-first search and synthesis

Search the wiki for answers. Reads `wiki/summaries.md`, scores relevance, loads top pages, follows links, and synthesizes an answer.

```bash
node skills/doc-wiki/scripts/parse_config.js --config <wiki-root>/wiki.config.yaml
```

Then read `wiki/summaries.md` and score page summaries against the question.

After answering, the wiki also prompts the user to save the answer as a permanent wiki page. Explicit promote of an archived answer is also available via `/doc-wiki:query --promote <file|last|N>`; bulk archive triage via `/doc-wiki:query --review`.

### /doc-wiki:lint -- Health check and auto-heal

Run structural checks, then apply LLM-driven quality analysis.

```bash
node skills/doc-wiki/scripts/lint_checks.js --wiki-root <wiki-root>
node skills/doc-wiki/scripts/quality_score.js --wiki-root <wiki-root>
```

### /doc-wiki:edit -- Targeted page edit

Read the target page, show a diff of current vs proposed changes, and apply if appropriate.

### /doc-wiki:unarchive -- Restore an archived page

Move an atlas-archived page from `wiki/_archive/` back into the live wiki, strip deprecation frontmatter, and revert inbound `(archived)` links.

```bash
node agents/lib/atlas_archive.js unarchive --wiki-root <wiki-root> --page <archive-path> [--target <wiki-relative-path>] [--yes]
```

Pages atlas detects as orphaned (sources removed from code) are moved to `wiki/_archive/` and excluded from the main wiki surface. Restore via `/doc-wiki:unarchive <slug>`.

### /doc-wiki:query path mode -- Shortest path between concepts

When `/doc-wiki:query` is given `--from <a>` and `--to <b>` instead of a positional question, it runs in path mode:

```bash
node skills/doc-wiki/scripts/graph_ops.js path --from "<concept-a>" --to "<concept-b>" --edges <wiki-root>/graph/edges.jsonl
```

Supports `--max-hops`, `--via`, `--all-paths`. Read-only — no archive, no synthesis.

### /doc-wiki:stats -- Token efficiency and cost metrics

```bash
node skills/doc-wiki/scripts/event_logger.js stats --wiki-root <wiki-root> --since 7d
```

## Script Paths

All TypeScript scripts live at: `skills/doc-wiki/scripts/` and compile to sibling `.js` files via `npm run build`.

| Script | Purpose |
|---|---|
| `init_wiki.ts` | Bootstrap wiki scaffold |
| `parse_config.ts` | Read/write `wiki.config.yaml` |
| `cache_manager.ts` | Content-hash cache for dedup |
| `security_check.ts` | URL validation and safety |
| `extract_binary.ts` | Binary file extraction |
| `lint_checks.ts` | Structural lint checks |
| `quality_score.ts` | Page quality scoring (0.0-1.0) |
| `graph_ops.ts` | Graph traversal and path queries |
| `event_logger.ts` | Operation logging and stats |
| `mermaid_lint.ts` | Mermaid diagram validation |
| `daily_summary.ts` | Daily summary generation |

## Agent Paths

Sub-agents live at `agents/`. External-source fetching is handled by the connectors bundled inside `narai-primitives` and dispatched through its `gather()` planner — no per-service subagents in doc-wiki.

| Agent | Purpose |
|---|---|
| `wiki-orm-agent` | ORM profile detection |
| `wiki-mermaid-agent` | Mermaid diagram generation |
| `wiki-claude-md-agent` | CLAUDE.md maintenance |
| `wiki-readme-agent` | Sync repo-root `README.md` quickstart block against `wiki/getting-started.md`; dispatched alongside `wiki-claude-md-agent` in atlas Phase 8 |

## Post-Operation Hooks

After any write operation (`/doc-wiki:ingest`, `/doc-wiki:edit`, `/doc-wiki:query --promote`, `/doc-wiki:unarchive`), run crosslink and tag-harmonize passes if the wiki has 3 or more pages. Skip with `--no-crosslink` or `--no-tag-harmonize`.

## Invocation Pattern

All scripts follow this pattern:

```bash
node skills/doc-wiki/scripts/<script>.js <args>
```

Install dependencies and build first (Node 20 required):

```bash
npm install
npm run build
```

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
