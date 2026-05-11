# doc-wiki -- Documentation Wiki Conventions (Aider)

This project has a documentation wiki skill. Before searching the codebase with grep or find, check if the wiki has the answer by querying `wiki/summaries.md` first.

## Commands

- `/doc-wiki:init` -- Bootstrap wiki: `node skills/doc-wiki/scripts/init_wiki.js --path <wiki-root> --domain "<domain>" --name "<name>"`
- `/doc-wiki:onboard` -- Detect language, ORM, database, external services; configure wiki
- `/doc-wiki:ingest` -- Fetch, extract, compile sources into wiki pages
- `/doc-wiki:query` -- Two modes: synthesis (`<question>`) for summary-first search, or path mode (`--from <a> --to <b>`) for shortest-path traversal via `node skills/doc-wiki/scripts/graph_ops.js path --edges <wiki-root>/graph/edges.jsonl`
- `/doc-wiki:lint` -- Health check: `node skills/doc-wiki/scripts/lint_checks.js --wiki-root <wiki-root>`
- `/doc-wiki:fix` -- Quick corrections with diff preview
- `/doc-wiki:promote` -- Convert query answer from `outputs/queries/` to permanent wiki page
- `/doc-wiki:refresh` -- Re-fetch and update from original sources
- `/doc-wiki:stats` -- Token efficiency: `node skills/doc-wiki/scripts/event_logger.js stats --wiki-root <wiki-root> --since 7d`

## Script Paths

All TypeScript scripts at `skills/doc-wiki/scripts/` (compile to `.js` siblings via `npm run build`):

- `init_wiki.ts` -- Bootstrap wiki scaffold
- `parse_config.ts` -- Read/write `wiki.config.yaml`
- `cache_manager.ts` -- Content-hash cache for dedup
- `security_check.ts` -- URL validation and safety
- `extract_binary.ts` -- Binary file extraction
- `lint_checks.ts` -- Structural lint checks
- `quality_score.ts` -- Page quality scoring (0.0-1.0)
- `graph_ops.ts` -- Graph traversal and path queries
- `event_logger.ts` -- Operation logging and stats
- `mermaid_lint.ts` -- Mermaid diagram validation
- `daily_summary.ts` -- Daily summary generation

## Agent Paths

Sub-agents at `agents/`. External-source fetching is handled by the connectors bundled inside `narai-primitives` and dispatched through its `gather()` planner — no per-service subagents in doc-wiki.

- `wiki-orm-agent` -- ORM profile detection
- `wiki-mermaid-agent` -- Mermaid diagram generation
- `wiki-claude-md-agent` -- CLAUDE.md maintenance
- `wiki-readme-agent` -- Sync repo-root `README.md` quickstart block against `wiki/getting-started.md`; dispatched alongside `wiki-claude-md-agent` in atlas Phase 8

## Invocation

```bash
node skills/doc-wiki/scripts/<script>.js <args>
```

Install dependencies (Node 20 required): `npm install && npm run build`

## Post-Operation Hooks

After write operations (ingest, fix, promote, refresh), run crosslink and tag-harmonize passes if the wiki has 3+ pages. Skip with `--no-crosslink` or `--no-tag-harmonize`.

## Documentation

Public-facing docs live in [`docs/`](docs/) at the repo root: [`getting-started.md`](docs/getting-started.md), [`commands.md`](docs/commands.md), [`configuration.md`](docs/configuration.md), [`connectors.md`](docs/connectors.md), [`troubleshooting.md`](docs/troubleshooting.md). Architecture internals are at [`internals/architecture.md`](docs/internals/architecture.md).

<!-- wiki-managed: reference start -->
## Reference

### Documentation index

- [`README.md`](../README.md) — repo entry point + quickstart
- [`docs/README.md`](../docs/README.md) — public-facing documentation index
- [`docs/getting-started.md`](../docs/getting-started.md) — first-run walkthrough
- [`docs/internals/architecture.md`](../docs/internals/architecture.md) — full architecture overview

### Coding agent configuration registry

Per-tool configuration lives at the repo root in this very file family:

| Tool | Config file |
|---|---|
| Claude Code | [`CLAUDE.md`](../CLAUDE.md) |
| Codex / OpenAI agents | [`AGENTS.md`](../AGENTS.md) |
| Gemini | [`GEMINI.md`](../GEMINI.md) |
| Cursor | [`.cursor/rules/doc-wiki.mdc`](../.cursor/rules/doc-wiki.mdc) |
| Aider | [`.aider/conventions.md`](../.aider/conventions.md) |

### Other references

- [`docs/atlas.md`](../docs/atlas.md) — `/doc-wiki:atlas` reference
- [`docs/commands.md`](../docs/commands.md) — every `/doc-wiki:*` slash command
- [`docs/configuration.md`](../docs/configuration.md) — `wiki.config.yaml` schema
- [`docs/troubleshooting.md`](../docs/troubleshooting.md) — symptom → cause → fix
- [`docs/connectors.md`](../docs/connectors.md) — connector setup
<!-- wiki-managed: reference end -->
