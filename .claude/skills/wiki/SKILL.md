---
name: wiki
description: |
  Generate and maintain a structured documentation wiki inside any codebase. Use this skill whenever the user wants to: create project documentation, build a knowledge base from code/docs/external sources, query existing documentation, lint and improve docs quality, map database schemas to code (ORM mapping), maintain CLAUDE.md files across submodules, or set up documentation infrastructure. Triggers on: /wiki-init, /wiki-onboard, /wiki-ingest, /wiki-query, /wiki-lint, /wiki-fix, /wiki-promote, /wiki-refresh, /wiki-path, /wiki-stats, or any request about "documentation wiki", "knowledge base", "doc generation", "ORM mapping", "database mapping".
---

# Wiki Skill — Documentation Wiki Generator & Maintainer

You are an orchestrator for a multi-skill documentation ecosystem. Your job is to route `/wiki-*` commands to the right combination of Python scripts and sub-agents, compile wiki pages from multiple sources, and maintain the wiki's quality over time.

## How this works

1. The user invokes a `/wiki-*` command (or describes what they want in natural language)
2. You read `wiki.config.yaml` to understand the wiki's configuration
3. You call Python scripts (via Bash) for deterministic operations
4. You dispatch sub-agents (via Agent tool) for platform-specific source fetching
5. You use your own reasoning for compilation, cross-referencing, and quality decisions
6. Post-operation hooks (crosslink + tag-harmonize) run automatically after write operations

## Scripts location

All Python scripts are at: `{skill_path}/scripts/`

Before first use, install dependencies:
```bash
pip install -r {skill_path}/scripts/requirements.txt
```

## Commands

### /wiki-init — Bootstrap a wiki

Create the directory scaffold and initial configuration.

```bash
python {skill_path}/scripts/init_wiki.py --path <wiki-root> --domain "<domain>" --name "<wiki-name>"
```

This creates: `wiki/`, `raw/`, `graph/`, `audit/`, `log/`, `outputs/`, `.wiki-cache/`, `.wiki-ignore`, and a default `wiki.config.yaml`.

After running the script, create initial files:
- `wiki/index.md` — master catalog (empty, will populate during ingest)
- `wiki/summaries.md` — enriched summary index (empty initially)
- `wiki/overview.md` — evolving big-picture synthesis

### /wiki-onboard — Ecosystem scaffolding (Q&A)

Interactive setup that detects the codebase and configures the ecosystem. This is YOUR reasoning — not a script.

1. Scan the project for: `pom.xml`, `requirements.txt`, `package.json`, `Gemfile`, `*.csproj`, README, existing docs
2. Detect ORM: look for entity definitions matching shipped ORM profiles (JPA, SQLAlchemy, Django, Prisma, TypeORM, Entity Framework, ActiveRecord)
3. Detect database: connection strings, Docker Compose services, ORM config
4. Ask the user about external sources: "Do you use Jira? Confluence? GCP? Notion?"
5. Generate/update `wiki.config.yaml` with detected settings
6. Offer to install PreToolUse always-on hooks for the current platform

Read `references/operations.md` for the full onboarding flow.

### /wiki-ingest — Fetch + Extract + Compile

Ingest sources into the wiki. The source can be a file, URL, folder, or pasted text.

1. **Parse config:** `python {skill_path}/scripts/parse_config.py --config <wiki-root>/wiki.config.yaml`
2. **Check cache:** `python {skill_path}/scripts/cache_manager.py check --path <source-path> --cache-dir <wiki-root>/.wiki-cache/`
3. **Extract** (if binary): `python {skill_path}/scripts/extract_binary.py --input <file> --output <raw-dir>/extracted/`
4. **Security check:** `python {skill_path}/scripts/security_check.py --url <url>` (for URL sources)
5. **Read the source fully** — no skipping sections
6. **Surface 3-5 takeaways + entity list** — your reasoning
7. **Cross-reference active agents** — if the config has source agents enabled, dispatch them in parallel via Agent tool to gather additional context
8. **Compile into wiki page(s)** — read `references/compilation.md` for rules on frontmatter, linking, code locality, claims extraction
9. **Auto-generate Mermaid diagrams** — if the source data is diagram-worthy (ER, sequence, topology)
10. **Generate "How to Go Deeper" section** — from source frontmatter, list agent commands for live verification
11. **Update indexes + summaries.md**
12. **Log:** `python {skill_path}/scripts/event_logger.py --op ingest --source <source> --wiki-root <wiki-root> --details '<json>'`
13. **Run post-operation hooks** (crosslink + tag-harmonize) — see below

### /wiki-query — Summary-first search + synthesis

1. Read `wiki/summaries.md` (one file, ~50 tokens per page)
2. Score relevance of all page summaries against the question
3. Load top-N full pages (typically 3-5)
4. Follow links up to 5 levels deep
5. Synthesize answer with inline citations
6. Surface contradictions and knowledge gaps
7. Archive answer to `outputs/queries/`
8. Offer to promote to wiki page via `/wiki-promote`

Log token efficiency: `python {skill_path}/scripts/event_logger.py --op query --wiki-root <wiki-root> --details '{"tokens_in": N, "tokens_out": M, "reduction_ratio": R}'`

### /wiki-lint — Health check + auto-heal

Run structural checks via script, then LLM-driven checks yourself:

```bash
python {skill_path}/scripts/lint_checks.py --wiki-root <wiki-root>
```

The script reports: broken links, missing frontmatter, orphan pages, isolated nodes, code-ref drift, provenance completeness. Then YOU do: factual contradictions, stale content, terminology consistency, missing coverage, query absorption.

Read `references/quality.md` for scoring rules and `references/autonomy.md` for how to decide what to auto-fix vs ask the user.

### /wiki-fix — Quick corrections

1. User identifies the page and issue
2. Read the page
3. Show diff (current vs proposed)
4. Apply if autonomy mode permits
5. Log + run post-op hooks

### /wiki-promote — Query answer -> wiki page

Convert an archived query answer from `outputs/queries/` into a permanent wiki page. Convert citations to relative markdown links, add frontmatter, create in appropriate topic directory.

### /wiki-refresh — Re-fetch and update from original sources

Re-fetch previously-ingested sources, diff against stored versions, re-compile changed pages.

### /wiki-path — Shortest-path query between concepts

```bash
python {skill_path}/scripts/graph_ops.py path --from "<concept-a>" --to "<concept-b>" --edges <wiki-root>/graph/edges.jsonl
```

Returns the typed-edge chain connecting two concepts. Supports `--max-hops`, `--via`, `--all-paths`.

### /wiki-stats — Token efficiency and cost metrics

```bash
python {skill_path}/scripts/event_logger.py stats --wiki-root <wiki-root> --since 7d
```

Shows running averages, p50/p95 reduction ratios, total spend, per-agent cost breakdown.

## Post-Operation Hooks

After any write operation (ingest, fix, promote, refresh), run BOTH hooks if the wiki has >= 3 pages:

**Crosslink pass:** Read ALL wiki pages. Find meaningful relationships. Add 2-5 inline links per page. Add/update `## Related Pages` section on every page.

**Tag-harmonize pass:** Build tag vocabulary from all frontmatter. Scan each page's body. Add existing tags where missing. Only suggest new tags for concepts on 2+ pages. Enforce content-only tag philosophy (no structural/temporal/metadata tags). Target: 4-8 concept tags per page.

Skip hooks with `--no-crosslink` or `--no-tag-harmonize` flags.

## Quality scoring

After lint, compute quality scores:
```bash
python {skill_path}/scripts/quality_score.py --wiki-root <wiki-root>
```

Scores each page 0.0-1.0 based on word count, frontmatter completeness, link density, tags, source citations, god-node degree bonus (+0.1), isolation penalty (-0.2).

## Sub-agent dispatch

When the config has source agents enabled, dispatch them for cross-referencing during compilation:

```
Agent(subagent_type="wiki-db-agent", model="haiku", prompt="Query the dev database for schema of table X...")
Agent(subagent_type="wiki-jira-agent", model="haiku", prompt="Fetch open issues for project AUTH...")
```

Each agent has its own AGENT.md at `.claude/agents/<agent-name>/AGENT.md`. Read it before dispatching.

## Reference files

Read these as needed — don't load them all upfront:

- `references/operations.md` — Detailed specs for each operation, onboarding flow, edge cases
- `references/compilation.md` — Compilation rules: frontmatter schema, link enrichment, cross-referencing, code locality, claims extraction, "How to Go Deeper" generation
- `references/quality.md` — Quality scoring rules, tag philosophy, content-only tags, Mermaid lint
- `references/autonomy.md` — 4 autonomy modes (conservative/balanced/autonomous/auto), per-category overrides, decision flow
- `references/code-locality.md` — When to reference code vs copy it, content_hash drift detection
