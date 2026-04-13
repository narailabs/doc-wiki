# doc-wiki

Documentation wiki generator and maintainer. Runs entirely inside Claude Code as skills + agents + TypeScript helper scripts.

## Architecture

- **Main skill:** `.claude/skills/wiki/SKILL.md` — orchestrates all `/wiki-*` commands
- **Slash-command wrappers:** `.claude/commands/wiki-*.md` — 10 thin wrappers so `/wiki-init`, `/wiki-onboard`, etc. appear in Claude Code's slash-command autocomplete and route into the skill
- **No standalone CLI** — all LLM calls go through Claude Code's session
- **Runtime:** Node 20. All scripts are TypeScript; `npm run build` emits sibling `.js` files that are invoked with `node`.

### Slash commands (10) — `.claude/commands/`

Thin wrappers so each documented `/wiki-*` subcommand is discoverable in Claude Code's slash-command autocomplete. Each wrapper invokes the `wiki` skill with the matching subcommand and passes `$ARGUMENTS` through. Files: `wiki-init.md`, `wiki-onboard.md`, `wiki-ingest.md`, `wiki-query.md`, `wiki-lint.md`, `wiki-fix.md`, `wiki-promote.md`, `wiki-refresh.md`, `wiki-path.md`, `wiki-stats.md`.

### TypeScript scripts (11) — `.claude/skills/wiki/scripts/`

Deterministic operations: hashing, parsing, graph ops, lint, security.

| Script | Purpose |
|--------|---------|
| `init_wiki.ts` | Scaffold wiki directory structure and config |
| `parse_config.ts` | Read and validate `wiki.config.yaml` |
| `event_logger.ts` | Append structured events to `events.jsonl` |
| `graph_ops.ts` | Relationship graph queries (paths, clusters, orphans) |
| `lint_checks.ts` | Frontmatter and link validation |
| `quality_score.ts` | Per-page and aggregate quality scoring |
| `cache_manager.ts` | Content-hash cache for incremental processing |
| `daily_summary.ts` | Generate daily digest of wiki changes |
| `extract_binary.ts` | Extract text from binary files (PDF, DOCX, etc.) |
| `mermaid_lint.ts` | Validate Mermaid diagram syntax |
| `security_check.ts` | URL validation, path containment, input sanitization |

### Agents (10) — `.claude/agents/`

**Source agents (6):** fetch and normalize content from external platforms.

| Agent | Platform |
|-------|----------|
| `wiki-confluence-agent` | Confluence pages and spaces |
| `wiki-jira-agent` | Jira issues and epics |
| `wiki-github-agent` | GitHub repos, PRs, issues, wikis |
| `wiki-notion-agent` | Notion pages and databases |
| `wiki-gcp-agent` | GCP documentation and configs |
| `wiki-aws-agent` | AWS documentation and configs |

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

ORM profile definitions ship as YAML files under `.claude/agents/lib/wiki_orm/profiles/*.yaml` and are loaded by the TypeScript mapper at runtime.

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
Python-to-TypeScript migration plan: `/Users/narayan/.claude/plans/synthetic-leaping-truffle.md`

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
| Wiki scripts | `npx vitest run .claude/skills/wiki/scripts/tests/` |
| Database agent | `npx vitest run .claude/agents/lib/wiki_db/tests/` |
| ORM mapper | `npx vitest run .claude/agents/lib/wiki_orm/tests/` |
| CLAUDE.md gen | `npx vitest run .claude/agents/wiki-claude-md-agent/scripts/tests/` |
| Mermaid gen | `npx vitest run .claude/agents/wiki-mermaid-agent/scripts/tests/` |
| **Full suite** | `npm test` (alias for `vitest run`) |
| Typecheck | `npm run typecheck` |
| Build | `npm run build` |
| Skills/agents | `/skill-creator` evals |

Current status: **677 tests passed, 5 skipped (live-DB integration tests, gated behind `TEST_LIVE_*` env vars)**.

## Key conventions

- Standard markdown links for all wiki navigation (NOT wikilinks)
- `edges.jsonl` for typed relationship metadata (supports, contradicts, extends, supersedes)
- Provenance tags on every edge (EXTRACTED / INFERRED / AMBIGUOUS)
- Content-only concept tags (no structural/temporal/metadata tags)
- Security Baseline: URL validation, path containment, size/timeout caps, label sanitization
- Guard-rail policy for database agent: ALLOW / DENY / ESCALATE / PRESENT_ONLY
- No Python in this repo. To verify: `find . -name '*.py' -not -path './node_modules/*' -not -path './wiki-workspace/*' -not -path './.worktrees/*/node_modules/*'` should return only the ORM extractor fixture source files under `.claude/agents/lib/wiki_orm/tests/fixtures/{sqlalchemy,django}/` (input data read as text by TypeScript tests).
