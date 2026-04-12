# doc-wiki -- Documentation Wiki Skill (Codex)

This project has a documentation wiki skill that generates and maintains structured documentation from code, external sources, and manual input. All wiki operations are driven by Python scripts and sub-agents.

## Before You Search

Before searching the codebase with grep, find, or glob, check if the wiki already has the answer. Run wiki-query first:

```bash
python3 .claude/skills/wiki/scripts/parse_config.py --config wiki.config.yaml
```

Then search `wiki/summaries.md` for relevant pages.

## Commands

### /wiki-init -- Bootstrap a wiki

Create the directory scaffold and initial configuration.

```bash
python3 .claude/skills/wiki/scripts/init_wiki.py --path <wiki-root> --domain "<domain>" --name "<wiki-name>"
```

### /wiki-onboard -- Interactive onboarding

Detect the codebase ecosystem (language, ORM, database, external services) and configure wiki infrastructure. This is an interactive flow -- scan for marker files, dispatch detection agents, then ask the user to confirm findings.

Detection agents:
```bash
# ORM detection
python3 .claude/agents/wiki-orm-agent/detect.py
# Database detection
python3 .claude/agents/wiki-db-agent/detect.py
```

### /wiki-ingest -- Fetch, extract, compile

Ingest a source (file, URL, folder, pasted text) into the wiki.

```bash
# Check cache first
python3 .claude/skills/wiki/scripts/cache_manager.py check --path <source-path> --cache-dir <wiki-root>/.wiki-cache/

# Security check for URLs
python3 .claude/skills/wiki/scripts/security_check.py --url <url>

# Extract binary files
python3 .claude/skills/wiki/scripts/extract_binary.py --input <file> --output <raw-dir>/extracted/

# Log the operation
python3 .claude/skills/wiki/scripts/event_logger.py --op ingest --source <source> --wiki-root <wiki-root> --details '<json>'
```

### /wiki-query -- Summary-first search and synthesis

Search the wiki for answers. Reads `wiki/summaries.md`, scores relevance, loads top pages, follows links, and synthesizes an answer.

```bash
# Parse config to find wiki root
python3 .claude/skills/wiki/scripts/parse_config.py --config <wiki-root>/wiki.config.yaml
```

Then read `wiki/summaries.md` and score page summaries against the question.

### /wiki-lint -- Health check and auto-heal

Run structural checks, then apply LLM-driven quality analysis.

```bash
python3 .claude/skills/wiki/scripts/lint_checks.py --wiki-root <wiki-root>
python3 .claude/skills/wiki/scripts/quality_score.py --wiki-root <wiki-root>
```

### /wiki-fix -- Quick corrections

Read the target page, show a diff of current vs proposed changes, and apply if appropriate.

### /wiki-promote -- Query answer to wiki page

Convert an archived query answer from `outputs/queries/` into a permanent wiki page with proper frontmatter and relative markdown links.

### /wiki-path -- Shortest path between concepts

```bash
python3 .claude/skills/wiki/scripts/graph_ops.py path --from "<concept-a>" --to "<concept-b>" --edges <wiki-root>/graph/edges.jsonl
```

Supports `--max-hops`, `--via`, `--all-paths`.

### /wiki-refresh -- Re-fetch and update from sources

Re-fetch previously ingested sources, diff against stored versions, re-compile changed pages.

### /wiki-stats -- Token efficiency and cost metrics

```bash
python3 .claude/skills/wiki/scripts/event_logger.py stats --wiki-root <wiki-root> --since 7d
```

## Script Paths

All Python scripts live at: `.claude/skills/wiki/scripts/`

| Script | Purpose |
|---|---|
| `init_wiki.py` | Bootstrap wiki scaffold |
| `parse_config.py` | Read/write `wiki.config.yaml` |
| `cache_manager.py` | Content-hash cache for dedup |
| `security_check.py` | URL validation and safety |
| `extract_binary.py` | Binary file extraction |
| `lint_checks.py` | Structural lint checks |
| `quality_score.py` | Page quality scoring (0.0-1.0) |
| `graph_ops.py` | Graph traversal and path queries |
| `event_logger.py` | Operation logging and stats |
| `mermaid_lint.py` | Mermaid diagram validation |
| `daily_summary.py` | Daily summary generation |

## Agent Paths

Sub-agents live at `.claude/agents/` and handle platform-specific source fetching:

| Agent | Purpose |
|---|---|
| `wiki-db-agent` | Database schema detection and queries |
| `wiki-orm-agent` | ORM profile detection |
| `wiki-jira-agent` | Jira issue fetching |
| `wiki-confluence-agent` | Confluence page fetching |
| `wiki-gcp-agent` | GCP service discovery |
| `wiki-aws-agent` | AWS service discovery |
| `wiki-github-agent` | GitHub wiki/discussions/boards |
| `wiki-notion-agent` | Notion page fetching |
| `wiki-mermaid-agent` | Mermaid diagram generation |
| `wiki-claude-md-agent` | CLAUDE.md maintenance |

## Post-Operation Hooks

After any write operation (ingest, fix, promote, refresh), run crosslink and tag-harmonize passes if the wiki has 3 or more pages. Skip with `--no-crosslink` or `--no-tag-harmonize`.

## Python Invocation Pattern

All scripts follow this pattern:

```bash
python3 .claude/skills/wiki/scripts/<script>.py <args>
```

Install dependencies first:

```bash
pip install -r .claude/skills/wiki/scripts/requirements.txt
```
