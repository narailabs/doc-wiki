# Wiki Operations — Detailed Specifications

Reference for the wiki SKILL.md orchestrator. Read the section relevant to the current operation.

## /doc-wiki:onboard — Ecosystem Scaffolding

### Codebase Detection

Scan the project directory for these markers:

| File/Pattern | Indicates |
|---|---|
| `pom.xml`, `build.gradle` | Java/Spring Boot |
| `requirements.txt`, `pyproject.toml`, `setup.py` | Python |
| `package.json` | Node.js/TypeScript |
| `Gemfile` | Ruby |
| `*.csproj`, `*.sln` | C#/.NET |
| `go.mod` | Go |
| `Cargo.toml` | Rust |
| `docker-compose.yml` | Docker services (may reveal DB type) |
| `README.md`, `docs/` | Existing documentation |

### ORM Detection

After identifying the language, look for ORM markers:

| ORM | Language | Detection Pattern |
|---|---|---|
| JPA/Hibernate | Java | `@Entity`, `@Table`, `extends JpaRepository` |
| SQLAlchemy | Python | `declarative_base()`, `__tablename__`, `Column()` |
| Django ORM | Python | `models.Model`, `class Meta: db_table` |
| Prisma | TypeScript | `schema.prisma` file with `model` blocks |
| TypeORM | TypeScript | `@Entity()` decorator, `@Column()` |
| Entity Framework | C# | `[Table("...")]`, `DbContext`, `DbSet<>` |
| ActiveRecord | Ruby | `< ApplicationRecord`, `has_many`, `belongs_to` |

If an ORM is detected, note the profile name. If unknown, ask the user.

### Database Detection

Look for:
- Connection strings in config files (application.yml, .env, settings.py)
- Docker Compose services (postgres, mysql, mongo, redis)
- ORM config files (persistence.xml, alembic.ini, database.yml)

### Q&A Flow

Ask these in order (skip if already detected):

1. "I detected [language/framework]. Is that correct?"
2. "I found [ORM] annotations. Should I set up ORM mapping?"
3. "I see a [database] in your Docker Compose. Should I configure the database agent for it?"
4. "Do you use any of these external services? Jira, Confluence, GCP, Notion, AWS, GitHub"
5. "Which autonomy mode? (balanced is recommended for interactive use)"
6. "Should I install always-on hooks for Claude Code?"

### Output

Update or create `wiki.config.yaml` with detected settings. Run `/doc-wiki:init` if the scaffold doesn't exist.

---

## /doc-wiki:init — Bootstrap

Run `init_wiki.ts` (compiled to `init_wiki.js`, invoked via `node`) to create the scaffold. Then:

1. Create `wiki/index.md`:
```markdown
---
title: "{wiki_name} — Index"
type: index
tags: []
created: {today}
updated: {today}
summary: "Master catalog for {wiki_name}"
---

# {wiki_name}

*No pages yet. Run `/doc-wiki:ingest` to add content.*
```

2. Create `wiki/summaries.md`:
```markdown
# {wiki_name} — Summaries

*Enriched summary index. Updated after every ingest.*
```

3. Create `wiki/overview.md`:
```markdown
---
title: "{wiki_name} — Overview"
type: summary
tags: [{domain}]
created: {today}
updated: {today}
summary: "Big-picture synthesis of {wiki_name}"
---

# Overview

*This page evolves as content is added. It synthesizes the big picture.*
```

---

## /doc-wiki:ingest — Full Pipeline

### Step-by-step

1. **Dispatch detection**: Match source against dispatch rules in config. File paths → file agent. URLs → firecrawl. `db:` prefix → database agent. Unknown → ask user or LLM-decide based on autonomy mode.

2. **Security check**: Run `security_check.ts` (`node security_check.js`) for URLs. Check path containment for file paths.

3. **Cache check**: Run `cache_manager.ts` (`node cache_manager.js check`). If cached and cache_version matches, skip extraction.

4. **Extract**: For `.pdf` / `.docx` / `.pptx`, run `extract_binary.ts` (`node extract_binary.js`). For images (`.png .jpg .jpeg .webp .gif .svg`), audio/video (`.mp4 .mp3 .wav .webm ...`), or YouTube URLs, run `extract_multimodal.ts` (`node extract_multimodal.js <input> --enabled <from-config>`) — it dispatches by extension or URL pattern and probes `faster-whisper` / `yt-dlp` on `PATH`. When the dispatcher returns `format: "skipped"`, surface the `warning` verbatim (names the missing tool + exact install command) and continue the batch; do not abort. For `vision` handoff, use the `Read` tool directly on the image. For markdown/text, read directly. When the source is a folder, call `loadIgnore(wikiRoot)` from `_wiki_fs.ts` and skip any paths matched by `.wiki-ignore` (gitignore-syntax, evaluated relative to `wikiRoot`).

5. **Read fully**: Read the entire source. No skipping sections.

6. **Surface takeaways**: Identify 3-5 key takeaways and an entity list (people, tools, concepts mentioned).

7. **Cross-reference**: If multiple source agents are configured, dispatch them in parallel to gather additional context about the entities mentioned.

8. **Compile**: Create wiki page(s). See `compilation.md` for rules.

9. **Auto Mermaid**: Run `mermaid_inject.ts` (`node mermaid_inject.js --page <page> --agents <agent-outputs.json> --in-place`). It reads the JSON envelopes emitted by dispatched agents, picks up every `mermaid: {type, title, code}` field, and splices each diagram into the compiled page wrapped in `<!-- wiki-mermaid: <title> start/end -->` markers so a second ingest updates diagrams in place instead of stacking duplicates. Skip this step when no agent emitted a `mermaid` field.

10. **"How to Go Deeper"**: Run `how_to_go_deeper.ts` (`node how_to_go_deeper.js --sources '<json>' --enabled <csv> --wiki-root <wikiRoot>`) against the compiled page's `sources:` frontmatter. The helper classifies each source (jira/confluence/github/notion/gcp/aws/db/local-code/raw) and emits one bullet per external source with the exact agent command. Pass the enabled-agent list from `wiki.config.yaml` so bullets for disabled agents render as a "enable the wiki-X-agent" hint instead of an unrunnable command; `--wiki-root` locates the `wiki.config.yaml` whose `ecosystem.agents.custom` block registers custom connectors (cwd is probed when omitted). The helper returns an empty string when sources are all local `raw/…` (already in the wiki body); skip the section in that case.

11. **Update indexes**: Add a bullet to `wiki/index.md` for the new page (your reasoning). Then rebuild the summary index deterministically: `node summaries_rebuild.js --wiki-root <wikiRoot>`. The rebuilder walks every frontmatter-bearing page, emits one ~50-token summary per page in alphabetical order, and splices the `## Anti-repetition Memory` section from `banlist.buildBanlistSection()` at the end of the managed block. Content outside the `<!-- wiki-managed: summaries start/end -->` markers is preserved, so hand-written preambles survive re-runs.

12. **Log**: Run `event_logger.ts` (`node event_logger.js`) with operation details. Pass each dispatched sub-agent's stats under `details.agent_calls[]` so `/doc-wiki:stats` can report per-agent cost correctly. Entries have shape `{agent, model, tokens_in, tokens_out, cost_usd, elapsed_ms, status}`; totals are computed automatically.

13. **Post-op hooks**: Run crosslink + tag-harmonize passes.

### Frontmatter for raw sources

Every file saved to `raw/` gets frontmatter tracking its origin:
```yaml
---
source_url: https://blog.com/post       # or source_path for local files
provider: file                           # which agent fetched it
last_fetched: 2026-04-12
checksum: sha256:abc123                  # for change detection
---
```

---

## /doc-wiki:query — Summary-First Search

### Progressive Disclosure

1. Load `wiki/summaries.md` — ~50 tokens per page. This is the ONLY file loaded initially.
2. Score each page summary against the question. Use semantic relevance, not keyword matching.
3. Load full text of top 3-5 pages.
4. Follow links from those pages up to 5 levels deep (configurable via `--depth`).
5. Synthesize answer with `[inline citations](wiki/path/to/page.md)`.
6. Note contradictions and gaps.
7. Archive to `outputs/queries/{slug}.md`.

### Token efficiency

Log tokens used vs estimated full-corpus read. Report reduction ratio.

---

## /doc-wiki:refresh — Re-fetch Sources

1. Scan `raw/` frontmatter for `source_url` and `checksum`.
2. Re-fetch each source using original provider.
3. Compare new content hash against stored checksum.
4. If changed: archive old version to `raw/history/`, update raw, re-compile affected wiki pages.
5. If unchanged: skip.

`--incremental`: Use `.wiki-cache/` to skip extraction if content hash matches. Only short-circuits extraction, never the source fetch.

Default is force-full (re-extract everything). `--incremental` is the speed optimization.

---

## /doc-wiki:fix — Quick Targeted Correction

Use when the user identifies a specific page and a specific issue (factual error, stale reference, outdated claim, broken link, wrong code reference).

1. Resolve the page — accept either a relative path (`topics/auth/jwt-rotation.md`) or a fuzzy title match against `wiki/index.md`.
2. Read the page fully, including frontmatter.
3. Form a proposal — describe the edit as a unified diff the user can eyeball.
4. Autonomy gate — apply per `references/autonomy.md`:
   - `conservative`: always ask before applying.
   - `balanced`: auto-apply fixes scoped to a single paragraph or code-ref; ask for structural changes (frontmatter, section reorder).
   - `autonomous`: auto-apply, notify after.
   - `auto`: use the per-operation risk score.
5. Write the edit. Re-emit frontmatter in canonical order (see `compilation.md`).
6. Event log: `node {skill_path}/scripts/event_logger.js --op fix --wiki-root <root> --details '{"page": "...", "issue": "...", "applied": true}'`.
7. Run post-op hooks (crosslink + tag-harmonize) unless `--no-crosslink` or `--no-tag-harmonize`.

### When to split into two fixes
If a single page has two independent issues, propose and apply them as separate fix events so the audit trail stays grepable per issue.

---

## /doc-wiki:promote — Archived Query → Permanent Page

Convert `outputs/queries/<slug>.md` into a canonically-located wiki page.

1. Choose destination directory — the user may pass `--topic <dir>`, otherwise suggest one based on the answer's dominant entity tags.
2. Rewrite inline citations:
   - Relative-to-outputs paths become relative-to-destination paths.
   - External URLs are preserved verbatim (but re-run through `security_check.ts` before committing).
3. Add frontmatter: `title`, `type: synthesis`, `tags`, `sources` (from the archived citations), `promoted_from: outputs/queries/<slug>.md`, `created: <ISO-date>`.
4. Write to `wiki/<topic>/<slug>.md`.
5. Update `wiki/index.md` and append a summary line to `wiki/summaries.md` (50 tokens max, matching the summary convention).
6. Leave the archive — `outputs/queries/<slug>.md` is never deleted; it stays as historical provenance.
7. Event log: `--op promote --details '{"from": "outputs/queries/...", "to": "wiki/..."}'`.
8. Run post-op hooks.

### What NOT to promote
- Query answers that are already covered by existing pages — suggest `/doc-wiki:fix` on the existing page instead.
- Answers with unresolved contradictions flagged in `## Open Questions` — resolve first, promote second.

---

## /doc-wiki:query — Path Mode (Shortest-Path Between Concepts)

`/doc-wiki:query` has two modes. The default synthesis flow is covered above; this section covers **path mode**, which is triggered when the user passes `--from` and `--to` instead of a positional question.

```bash
node {skill_path}/scripts/graph_ops.js path \
  --edges <wiki-root>/graph/edges.jsonl \
  --from "<concept-a>" --to "<concept-b>" \
  [--max-hops N] [--via "<concept>"] [--all-paths]
```

The shim walks `edges.jsonl` (typed relationships: `supports`, `contradicts`, `extends`, `supersedes`, `references`, …) and returns an edge chain connecting the two concepts.

### Output shape
- Default: single shortest path with edge types annotated per hop, returned as `Edge[]`.
- `--all-paths`: up to 5 simple paths from `--from` to `--to` in graph-traversal (depth-first) order, returned as `Edge[][]`. Count-bounded, not hop-bounded; `--max-hops` and `--via` are ignored in this mode.
- `--via <concept>`: constrain the shortest path to pass through the named concept; useful for "how does X relate to Y through Z" queries.
- `--max-hops N`: cap path length; if no path exists within the cap, return `{"status": "no_path", "max_hops": N}`.

### Use cases
- "How does the auth subsystem relate to the rate-limit subsystem?"
- "Is the new caching proposal connected to any deprecated design we replaced?"
- "What path links a recent bug page to the original architecture decision?"

No autonomy gate — path mode is read-only and never writes.

---

## /doc-wiki:stats — Token Efficiency and Cost Metrics

```bash
node {skill_path}/scripts/event_logger.js stats \
  --wiki-root <root> \
  [--since 7d] [--per-agent] [--by-op]
```

Reads `log/events.jsonl` and aggregates across the requested window.

### Reported metrics
- **Running averages** — tokens-in, tokens-out, reduction ratio per op type.
- **p50 / p95 reduction** — how much context the summary-first strategy saved vs a naïve full-corpus read.
- **Spend** — total USD cost across the window, split by model where available.
- **Per-agent breakdown** (`--per-agent`) — cost + call count for each source agent (jira, confluence, github, notion, gcp, aws).
- **Per-op breakdown** (`--by-op`) — same metrics grouped by `/doc-wiki:*` command.

### Windowing
`--since` accepts `Nd` (days), `Nh` (hours), or an ISO-8601 instant. Default is `7d`.

### No writes
`wiki-stats` is a report-only command; it never mutates the wiki or the event log.
