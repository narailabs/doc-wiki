# doc-wiki -- Documentation Wiki Skill (Codex)

This project has a documentation wiki skill that generates and maintains structured documentation from code, external sources, and manual input. All wiki operations are driven by TypeScript scripts (compiled to JavaScript, invoked via `node`) and sub-agents.

## Documentation

Public-facing docs live in [`docs/`](docs/). For Codex users:

- [`docs/getting-started.md`](docs/getting-started.md) — install + first ingest
- [`docs/commands.md`](docs/commands.md) — reference for all 10 `/wiki-*` commands
- [`docs/configuration.md`](docs/configuration.md) — `wiki.config.yaml` and `.connectors/config.yaml` schemas
- [`docs/architecture.md`](docs/architecture.md) — full architecture with Mermaid diagrams
- [`docs/connectors.md`](docs/connectors.md) — the `narai-primitives` stack
- [`docs/troubleshooting.md`](docs/troubleshooting.md) — common failures

## Before You Search

Before searching the codebase with grep, find, or glob, check if the wiki already has the answer. Run wiki-query first:

```bash
node .claude/skills/wiki/scripts/parse_config.js --config wiki.config.yaml
```

Then search `wiki/summaries.md` for relevant pages.

## Commands

### /wiki-init -- Bootstrap a wiki

Create the directory scaffold and initial configuration.

```bash
node .claude/skills/wiki/scripts/init_wiki.js --path <wiki-root> --domain "<domain>" --name "<wiki-name>"
```

### /wiki-onboard -- Interactive onboarding

Detect the codebase ecosystem (language, ORM, database, external services) and configure wiki infrastructure. This is an interactive flow -- scan for marker files, dispatch detection agents, then ask the user to confirm findings.

ORM detection is dispatched via the Agent tool (`wiki-orm-agent`); database introspection runs through `gather()` from `narai-primitives` when live schema confirmation is needed.

### /wiki-ingest -- Fetch, extract, compile

Ingest a source (file, URL, folder, pasted text) into the wiki.

```bash
# Check cache first
node .claude/skills/wiki/scripts/cache_manager.js check --path <source-path> --cache-dir <wiki-root>/.wiki-cache/

# Security check for URLs
node .claude/skills/wiki/scripts/security_check.js --url <url>

# Extract binary files
node .claude/skills/wiki/scripts/extract_binary.js --input <file> --output <raw-dir>/extracted/

# Log the operation
node .claude/skills/wiki/scripts/event_logger.js --op ingest --source <source> --wiki-root <wiki-root> --details '<json>'
```

### /wiki-query -- Summary-first search and synthesis

Search the wiki for answers. Reads `wiki/summaries.md`, scores relevance, loads top pages, follows links, and synthesizes an answer.

```bash
# Parse config to find wiki root
node .claude/skills/wiki/scripts/parse_config.js --config <wiki-root>/wiki.config.yaml
```

Then read `wiki/summaries.md` and score page summaries against the question.

### /wiki-lint -- Health check and auto-heal

Run structural checks, then apply LLM-driven quality analysis.

```bash
node .claude/skills/wiki/scripts/lint_checks.js --wiki-root <wiki-root>
node .claude/skills/wiki/scripts/quality_score.js --wiki-root <wiki-root>
```

### /wiki-fix -- Quick corrections

Read the target page, show a diff of current vs proposed changes, and apply if appropriate.

### /wiki-promote -- Query answer to wiki page

Convert an archived query answer from `outputs/queries/` into a permanent wiki page with proper frontmatter and relative markdown links.

### /wiki-path -- Shortest path between concepts

```bash
node .claude/skills/wiki/scripts/graph_ops.js path --from "<concept-a>" --to "<concept-b>" --edges <wiki-root>/graph/edges.jsonl
```

Supports `--max-hops`, `--via`, `--all-paths`.

### /wiki-refresh -- Re-fetch and update from sources

Re-fetch previously ingested sources, diff against stored versions, re-compile changed pages.

### /wiki-stats -- Token efficiency and cost metrics

```bash
node .claude/skills/wiki/scripts/event_logger.js stats --wiki-root <wiki-root> --since 7d
```

## Script Paths

All TypeScript scripts live at: `.claude/skills/wiki/scripts/` and compile to sibling `.js` files via `npm run build`.

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

Sub-agents live at `.claude/agents/`. External-source fetching is handled by the connectors bundled inside `narai-primitives` and dispatched through its `gather()` planner — no per-service subagents in doc-wiki.

| Agent | Purpose |
|---|---|
| `wiki-orm-agent` | ORM profile detection |
| `wiki-mermaid-agent` | Mermaid diagram generation |
| `wiki-claude-md-agent` | CLAUDE.md maintenance |

## Post-Operation Hooks

After any write operation (ingest, fix, promote, refresh), run crosslink and tag-harmonize passes if the wiki has 3 or more pages. Skip with `--no-crosslink` or `--no-tag-harmonize`.

## Invocation Pattern

All scripts follow this pattern:

```bash
node .claude/skills/wiki/scripts/<script>.js <args>
```

Install dependencies and build first (Node 20 required):

```bash
npm install
npm run build
```
