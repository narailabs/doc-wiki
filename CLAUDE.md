# doc-wiki

Documentation wiki generator and maintainer. Runs entirely inside Claude Code as skills + agents + Python helper scripts.

## Architecture

- **Main skill:** `.claude/skills/wiki/SKILL.md` — orchestrates all `/wiki-*` commands
- **Python scripts:** `.claude/skills/wiki/scripts/` — deterministic operations (hashing, parsing, graph ops, lint)
- **Agents:** `.claude/agents/` — per-platform source fetching (Jira, Confluence, GCP, etc.)
- **Shared libraries:** `.claude/agents/lib/` — `wiki_db` (database agent), `wiki_orm` (ORM mapper)
- **No standalone CLI** — all LLM calls go through Claude Code's session

## Design reference

Full v2 design: `/Users/narayan/research/doc-wiki/ideal-wiki-skill-report-v2.md`
Implementation plan: `/Users/narayan/.claude/plans/reactive-toasting-tulip.md`

## Testing

- Python scripts: `python -m pytest .claude/skills/wiki/scripts/tests/`
- Database agent: `python -m pytest .claude/agents/lib/wiki_db/tests/`
- ORM mapper: `python -m pytest .claude/agents/lib/wiki_orm/tests/`
- Skills/agents: `/skill-creator` evals

## Key conventions

- Standard markdown links for all wiki navigation (NOT wikilinks)
- `edges.jsonl` for typed relationship metadata (supports, contradicts, extends, supersedes)
- Provenance tags on every edge (EXTRACTED / INFERRED / AMBIGUOUS)
- Content-only concept tags (no structural/temporal/metadata tags)
- Security Baseline: URL validation, path containment, size/timeout caps, label sanitization
- Guard-rail policy for database agent: ALLOW / DENY / ESCALATE / PRESENT_ONLY
