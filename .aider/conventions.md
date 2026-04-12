# doc-wiki -- Documentation Wiki Conventions (Aider)

This project has a documentation wiki skill. Before searching the codebase with grep or find, check if the wiki has the answer by querying `wiki/summaries.md` first.

## Commands

- `/wiki-init` -- Bootstrap wiki: `python3 .claude/skills/wiki/scripts/init_wiki.py --path <wiki-root> --domain "<domain>" --name "<name>"`
- `/wiki-onboard` -- Detect language, ORM, database, external services; configure wiki
- `/wiki-ingest` -- Fetch, extract, compile sources into wiki pages
- `/wiki-query` -- Summary-first search: read `wiki/summaries.md`, score relevance, load top pages, synthesize
- `/wiki-lint` -- Health check: `python3 .claude/skills/wiki/scripts/lint_checks.py --wiki-root <wiki-root>`
- `/wiki-fix` -- Quick corrections with diff preview
- `/wiki-promote` -- Convert query answer from `outputs/queries/` to permanent wiki page
- `/wiki-path` -- Shortest path: `python3 .claude/skills/wiki/scripts/graph_ops.py path --from "<a>" --to "<b>" --edges <wiki-root>/graph/edges.jsonl`
- `/wiki-refresh` -- Re-fetch and update from original sources
- `/wiki-stats` -- Token efficiency: `python3 .claude/skills/wiki/scripts/event_logger.py stats --wiki-root <wiki-root> --since 7d`

## Script Paths

All Python scripts: `.claude/skills/wiki/scripts/`

- `init_wiki.py` -- Bootstrap wiki scaffold
- `parse_config.py` -- Read/write `wiki.config.yaml`
- `cache_manager.py` -- Content-hash cache for dedup
- `security_check.py` -- URL validation and safety
- `extract_binary.py` -- Binary file extraction
- `lint_checks.py` -- Structural lint checks
- `quality_score.py` -- Page quality scoring (0.0-1.0)
- `graph_ops.py` -- Graph traversal and path queries
- `event_logger.py` -- Operation logging and stats
- `mermaid_lint.py` -- Mermaid diagram validation
- `daily_summary.py` -- Daily summary generation

## Agent Paths

Sub-agents at `.claude/agents/`:

- `wiki-db-agent` -- Database schema detection and queries
- `wiki-orm-agent` -- ORM profile detection
- `wiki-jira-agent` -- Jira issue fetching
- `wiki-confluence-agent` -- Confluence page fetching
- `wiki-gcp-agent` -- GCP service discovery
- `wiki-aws-agent` -- AWS service discovery
- `wiki-github-agent` -- GitHub wiki/discussions/boards
- `wiki-notion-agent` -- Notion page fetching
- `wiki-mermaid-agent` -- Mermaid diagram generation
- `wiki-claude-md-agent` -- CLAUDE.md maintenance

## Python Invocation

```bash
python3 .claude/skills/wiki/scripts/<script>.py <args>
```

Install dependencies: `pip install -r .claude/skills/wiki/scripts/requirements.txt`

## Post-Operation Hooks

After write operations (ingest, fix, promote, refresh), run crosslink and tag-harmonize passes if the wiki has 3+ pages. Skip with `--no-crosslink` or `--no-tag-harmonize`.
