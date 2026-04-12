# doc-wiki

Documentation wiki generator and maintainer. Runs entirely inside Claude Code as skills + agents + Python helper scripts.

## Architecture

- **Main skill:** `.claude/skills/wiki/SKILL.md` — orchestrates all `/wiki-*` commands
- **No standalone CLI** — all LLM calls go through Claude Code's session

### Python scripts (11) — `.claude/skills/wiki/scripts/`

Deterministic operations: hashing, parsing, graph ops, lint, security.

| Script | Purpose |
|--------|---------|
| `init_wiki.py` | Scaffold wiki directory structure and config |
| `parse_config.py` | Read and validate `wiki.config.yaml` |
| `event_logger.py` | Append structured events to `events.jsonl` |
| `graph_ops.py` | Relationship graph queries (paths, clusters, orphans) |
| `lint_checks.py` | Frontmatter and link validation |
| `quality_score.py` | Per-page and aggregate quality scoring |
| `cache_manager.py` | Content-hash cache for incremental processing |
| `daily_summary.py` | Generate daily digest of wiki changes |
| `extract_binary.py` | Extract text from binary files (PDF, DOCX, etc.) |
| `mermaid_lint.py` | Validate Mermaid diagram syntax |
| `security_check.py` | URL validation, path containment, input sanitization |

### Agents (11) — `.claude/agents/`

**Source agents (7):** fetch and normalize content from external platforms.

| Agent | Platform |
|-------|----------|
| `wiki-confluence-agent` | Confluence pages and spaces |
| `wiki-jira-agent` | Jira issues and epics |
| `wiki-github-agent` | GitHub repos, PRs, issues, wikis |
| `wiki-notion-agent` | Notion pages and databases |
| `wiki-gcp-agent` | GCP documentation and configs |
| `wiki-aws-agent` | AWS documentation and configs |
| `wiki-auth0-agent` | Auth0 tenant configuration |

**Maintenance agents (2):** generate derived artifacts from wiki content.

| Agent | Purpose |
|-------|---------|
| `wiki-claude-md-agent` | Generate project `CLAUDE.md` from wiki pages |
| `wiki-mermaid-agent` | Generate Mermaid architecture diagrams |

**Integration agents (2):** bridge wiki with database and ORM schemas.

| Agent | Purpose |
|-------|---------|
| `wiki-db-agent` | Database schema documentation |
| `wiki-orm-agent` | ORM model documentation |

### Shared libraries (2) — `.claude/agents/lib/`

| Library | Purpose |
|---------|---------|
| `wiki_db` | Database agent with guard-rail policy (ALLOW / DENY / ESCALATE / PRESENT_ONLY) |
| `wiki_orm` | ORM mapper with 7 profiles: SQLAlchemy, Django, JPA, Prisma, TypeORM, ActiveRecord, Entity Framework |

### Reference docs (5) — `.claude/skills/wiki/references/`

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
| `.cursor/rules/wiki.mdc` | Cursor IDE |
| `.aider/conventions.md` | Aider |

## Design reference

Full v2 design: `/Users/narayan/research/doc-wiki/ideal-wiki-skill-report-v2.md`
Implementation plan: `/Users/narayan/.claude/plans/reactive-toasting-tulip.md`

## Testing

| Suite | Command |
|-------|---------|
| Wiki scripts | `python -m pytest .claude/skills/wiki/scripts/tests/` |
| Database agent | `python -m pytest .claude/agents/lib/wiki_db/tests/` |
| ORM mapper | `python -m pytest .claude/agents/lib/wiki_orm/tests/` |
| CLAUDE.md gen | `python -m pytest .claude/agents/wiki-claude-md-agent/scripts/tests/` |
| Mermaid gen | `python -m pytest .claude/agents/wiki-mermaid-agent/scripts/tests/` |
| **Full suite** | `python -m pytest .claude/skills/wiki/scripts/tests/ .claude/agents/lib/wiki_db/tests/ .claude/agents/lib/wiki_orm/tests/ .claude/agents/wiki-claude-md-agent/scripts/tests/ .claude/agents/wiki-mermaid-agent/scripts/tests/` |
| Skills/agents | `/skill-creator` evals |

Current status: **336 tests passed, 15 skipped**.

## Key conventions

- Standard markdown links for all wiki navigation (NOT wikilinks)
- `edges.jsonl` for typed relationship metadata (supports, contradicts, extends, supersedes)
- Provenance tags on every edge (EXTRACTED / INFERRED / AMBIGUOUS)
- Content-only concept tags (no structural/temporal/metadata tags)
- Security Baseline: URL validation, path containment, size/timeout caps, label sanitization
- Guard-rail policy for database agent: ALLOW / DENY / ESCALATE / PRESENT_ONLY
