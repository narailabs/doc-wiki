# Eval run — /wiki-init + /wiki-ingest + /wiki-query

Work area: `/tmp/eval-iiq-project/`
Skill under test: `/Users/narayan/src/doc-wiki/skills/wiki/SKILL.md`
Date: 2026-04-14

## User task (verbatim)

> I have a new Python project at /tmp/eval-iiq-project with some markdown docs in a docs/ folder. Initialize a documentation wiki for it with domain 'backend-services', ingest docs/architecture.md (about JWT auth and session management), and then query 'how does authentication work?'.

## Phase 0 — Fixture setup

- Created `/tmp/eval-iiq-project/docs/`.
- Wrote `/tmp/eval-iiq-project/docs/architecture.md` (~550 words, 3 headings): JWT Access Tokens (RS256, JWKS, 15-min exp), Server-Side Sessions (PostgreSQL `sessions` table, `session_id` cookie), Refresh Flow (`/auth/refresh` + `refresh_tokens` table, logout invalidation).

## Phase 1 — /wiki-init

Command:

```bash
node skills/wiki/scripts/init_wiki.js --path /tmp/eval-iiq-project \
  --domain "backend-services" --name "eval-iiq-project"
```

Scaffold created: `wiki/{,claims,synthesis,templates}`, `raw/`, `graph/`, `audit/{open,resolved}`, `log/{daily}`, `outputs/{queries,reports}`, `.wiki-cache/`, plus `wiki.config.yaml`, `wiki/{index,summaries,overview}.md`, `.wiki-ignore`, `log/events.jsonl`, `graph/edges.jsonl`, `.claude/settings.json`.

Config recorded `domain: backend-services`, autonomy `balanced`, multimodal `optional`, ORM enabled (profiles empty).

## Phase 2 — /wiki-ingest docs/architecture.md

SKILL.md flow executed verbatim:

1. `parse_config.js --config …/wiki.config.yaml` — OK.
2. `cache_manager.js check … --body-only` → `{"hit": false, "hash": "8b46715a…"}`.
3. No binary / multimodal / URL steps needed.
4. Read source fully; extracted 5 takeaways (RS256 JWT, server-side sessions, refresh rotation, logout revocation, JWKS verification).
5. No source agents enabled → no cross-referencing dispatch.
6. Compiled `wiki/auth/authentication.md` per `references/compilation.md`:
   - Frontmatter: `type: concept`, 6 concept tags (within 4-8 target), `sources: [raw/auth/architecture.md]`.
   - Four body sections matching source structure.
   - Two Mermaid diagrams: `sequenceDiagram` for the refresh flow and `erDiagram` for `users`/`sessions`/`refresh_tokens`.
   - "How to Go Deeper" section pointing to the raw source, JWKS endpoint, and a future `wiki agent db-query`.
   - "Related Pages" cross-links to index + summaries.
7. Copied source to `raw/auth/architecture.md`.
8. Appended EXTRACTED-provenance `supports` edge to `graph/edges.jsonl`.
9. Updated `wiki/index.md`, `wiki/summaries.md`, `wiki/overview.md` with frontmatter and cross-links to the new page.
10. `cache_manager.js store` — cache entry recorded.
11. `event_logger.js log --op ingest --wiki-root …` — event written.
12. Post-op hooks (crosslink + tag-harmonize): wiki has 4 pages (>=3 threshold); inline cross-links were written during compilation and the tag vocabulary is consistent across pages.

## Phase 3 — lint + auto-fix

`lint_checks.js` first pass: 3 errors (missing frontmatter on the scaffold stubs `index.md`, `summaries.md`, `overview.md`). Auto-fixed by adding proper frontmatter (autonomy `balanced` + `auto_fix.missing_frontmatter: true`). Second pass: 0 errors; 5 warnings (`isolated_node` × 4, `thin_cluster` × 1) expected for a 4-page wiki with one topical page.

`quality_score.js`:

| Page | Quality |
|---|---|
| `wiki/auth/authentication.md` | 0.90 |
| `wiki/overview.md` | 0.60 |
| `wiki/index.md` | 0.00 |
| `wiki/summaries.md` | 0.00 |

Auth page hits 0.9 (word count + frontmatter + links + tags + Mermaid). Index/summaries score low due to `no_sources` (expected for nav hubs) + isolation penalty on a near-empty graph.

## Phase 4 — /wiki-query "how does authentication work?"

- Read `wiki/summaries.md` first.
- Relevance scores: `auth/authentication.md` = 0.95, `overview.md` = 0.55, `index.md`/`summaries.md` = 0.15.
- Loaded top-2 pages (`authentication.md` + `overview.md`). Single topical page, so no deeper link traversal needed.
- Synthesized a 4-section answer (access tokens / sessions / refresh / logout) with inline section-anchor citations.
- Surfaced knowledge gaps: login/credential exchange, JWKS key rotation, scope derivation, anomaly-driven revocation.
- Archived to `outputs/queries/2026-04-14-how-does-authentication-work.md`.
- Logged `--op query` with `tokens_in=2088`, `tokens_out=1313`, `reduction_ratio=0.918`.

## What succeeded

- Scaffold + config correct (domain + name recorded).
- Source ingested into `wiki/auth/authentication.md` (quality 0.9) with Mermaid, frontmatter, tags, "How to Go Deeper".
- Raw source preserved with provenance edge.
- Cache + ingest + query events logged.
- Query answered with inline citations and archived.
- Lint clean (0 errors) after auto-fix.

## Caveats / noteworthy

- `init_wiki` seeds `index.md`, `summaries.md`, `overview.md` as frontmatter-less stubs; first lint pass flags them. Required a follow-up write to add frontmatter (in-spec for `balanced` autonomy + `auto_fix.missing_frontmatter: true`).
- Remaining lint warnings (`isolated_node`, `thin_cluster`) are inherent to a 4-page wiki with one topical page.
- No external source agents configured, so no `agent_calls[]` entries in the ingest event.

## Artifact tree in this output dir

- `wiki/{index,summaries,overview}.md` + `wiki/auth/authentication.md` — compiled wiki
- `raw/auth/architecture.md` — preserved source
- `graph/edges.jsonl` — typed provenance edge
- `log/events.jsonl` (and top-level `events.jsonl` copy) — ingest + query events
- `outputs/queries/2026-04-14-how-does-authentication-work.md` — archived query answer
- `wiki.config.yaml`, top-level `summaries.md`, `.wiki-ignore` — config / convenience copies
- `audit/` — created by scaffold, currently empty
- `report.md` — this file
