# Commands Reference

Every `/doc-wiki:*` command, what it does, the arguments it accepts, and an example or two. Each section links to the corresponding section of [`SKILL.md`](../skills/doc-wiki/SKILL.md) for the full procedural detail.

The ten commands group into three lifecycles:

- **Lifecycle** — set up and grow the wiki: `/doc-wiki:init`, `/doc-wiki:onboard`, `/doc-wiki:atlas`, `/doc-wiki:ingest`, `/doc-wiki:refresh`
- **Search** — find and analyze: `/doc-wiki:query` (synthesis or path mode), `/doc-wiki:stats`
- **Maintenance** — keep it healthy: `/doc-wiki:lint`, `/doc-wiki:fix`, `/doc-wiki:promote`

---

## Lifecycle

### `/doc-wiki:init` — Bootstrap a wiki

Create the directory scaffold and initial configuration.

**Synopsis:** `/doc-wiki:init [--path <wiki-root>] [--domain <domain>] [--name <wiki-name>]`

**Args:**

| Arg | Type | Default | Purpose |
|---|---|---|---|
| `--path` | path | `wiki/` | Wiki root directory (created if missing) |
| `--domain` | string | `general` | Broad topic for the wiki (e.g. `backend-services`, `infra`) |
| `--name` | string | (project name) | Wiki name; appears in frontmatter and overview |

**What it does:**

- Creates `wiki/`, `raw/`, `graph/`, `audit/`, `log/`, `outputs/`, `.wiki-cache/`, and `.wiki-ignore`.
- Generates `wiki.config.yaml` with safe defaults (autonomy: `balanced`, max_depth: 3, all built-in agents enabled).
- Writes empty `wiki/index.md`, `wiki/summaries.md`, and `wiki/overview.md` ready for the first ingest.
- **Idempotent.** Re-running won't overwrite existing files; it only creates what's missing.

**Examples:**

```text
/doc-wiki:init
/doc-wiki:init --domain "infra-platform" --name "Platform Wiki"
/doc-wiki:init --path ./docs/wiki --domain backend
```

**See also:** [`SKILL.md` § /doc-wiki:init](../skills/doc-wiki/SKILL.md), [`getting-started.md`](getting-started.md), [`init_wiki.ts`](../skills/doc-wiki/scripts/init_wiki.ts).

---

### `/doc-wiki:onboard` — Interactive onboarding

Detect the codebase ecosystem and configure wiki + connector access. Run once per project; idempotent (safe to re-run if the project changes).

**Synopsis:** `/doc-wiki:onboard [wiki-root]`

**Args:**

| Arg | Type | Default | Purpose |
|---|---|---|---|
| `wiki-root` | path | `./wiki` | Path to the wiki created by `/doc-wiki:init` |

**What it does:**

Six interactive phases:

1. **Detect language and framework** by reading marker files (`pom.xml`, `package.json`, `requirements.txt`, `go.mod`, `Cargo.toml`, `Gemfile`, `*.csproj`, `*.sln`).
2. **Detect ORM** by dispatching `wiki-orm-agent` against the codebase. Profiles supported: JPA, SQLAlchemy, Django, Prisma, TypeORM, Entity Framework, ActiveRecord.
3. **Detect databases** by reading Docker Compose, `.env`, ORM config (Django `DATABASES`, Spring `spring.datasource.url`, etc.). Credentials are redacted in the confirmation prompt.
4. **Ask about external services** — six yes/no questions covering Jira, Confluence, GCP, AWS, Notion, GitHub. Your answers go into `consumers.doc-wiki` in the connector config.
5. **Set up connector access** — checks for `~/.connectors/config.yaml` and `./.connectors/config.yaml`, generates a starter from the example if missing, then asks one credential question per enabled connector.
6. **Pick autonomy mode** — `conservative`, `balanced`, `autonomous`, or `auto`. See [`references/autonomy.md`](../skills/doc-wiki/references/autonomy.md). Most users start at `balanced`.

**Examples:**

```text
/doc-wiki:onboard
/doc-wiki:onboard ./docs/wiki
```

**See also:** [`SKILL.md` § /doc-wiki:onboard](../skills/doc-wiki/SKILL.md), [`configuration.md`](configuration.md).

---

### `/doc-wiki:atlas` — Full application documentation

Generate a comprehensive wiki for the entire codebase in one orchestrated pass. A meta-orchestrator over `/doc-wiki:ingest` — discovers topics from multiple signals, batches ingest across topics × facets, synthesizes global aggregation pages, and on existing wikis validates content against current source state via gitlog and semantic checks.

**Synopsis:** `/doc-wiki:atlas [--facets <list>] [--scope <topic>] [--yes] [--dry-run] [--max-cost <usd>] [--since <duration>] [--validate-mode shallow|full] [--resume] [--wiki-root <path>]`

**Args:**

| Arg | Type | Default | Purpose |
|---|---|---|---|
| `--facets` | csv | `architecture,data-model,environments,api,operations` | Per-topic facets to generate. **Additive** — never deletes pages outside this set from prior runs. |
| `--scope` | string | (all topics) | Restrict to one topic for incremental runs |
| `--yes` | flag | (off) | Skip phase confirmation gates (CI/unattended) |
| `--dry-run` | flag | (off) | Show planned ingests + cost estimate, write nothing (validation pass still runs read-only) |
| `--max-cost` | usd | `200.00` | Abort pre-write if estimate exceeds; re-run with explicit higher value to override |
| `--since` | duration | last `op: atlas` event timestamp, else all-time | Window for the gitlog drift scan |
| `--validate-mode` | `shallow` \| `full` | `shallow` | `shallow`: structural + gitlog + semantic on sampled pages. `full`: semantic on every existing atlas page. |
| `--resume` | flag | (off) | Continue from `.wiki-checkpoint.json` (`opName: atlas`) without prompting |
| `--wiki-root` | path | `./wiki` | Path to the wiki |

**What it does:**

The eight-phase pipeline (full description in [`SKILL.md` § /doc-wiki:atlas](../skills/doc-wiki/SKILL.md)):

1. Detect state (fresh / existing / hybrid) by counting atlas-tagged pages and reading `events.jsonl`.
2. Discover topics by unioning four signals: top-level code dirs, ORM domains via `wiki-orm-agent`, existing `wiki/<topic>/` dirs, gitlog churn hotspots.
3. Confirm topic list (gated by autonomy mode; `--yes` skips).
4. Estimate cost; abort pre-write if over `--max-cost`.
5. Validate existing atlas pages (existing/hybrid wikis only) — structural lint + gitlog drift + semantic LLM check with `(page-hash, source-hash)` cache.
6. Bootstrap or refresh — dispatch `/doc-wiki:ingest <source> --output <path>` per `(topic, facet)` not cached, plus `/doc-wiki:refresh` for drift-flagged pages.
7. Synthesize the three global pages (`overview.md`, `integrations.md`, `deploy.md`) by aggregating per-topic content.
8. Finalize — lint, update `wiki/index.md`, run global crosslink + tag-harmonize, log `op: atlas` event, clear checkpoint, write drift + cost reports under `wiki/outputs/atlas/<run-id>/`.

Each atlas-generated page carries two extra frontmatter fields: `atlas_facet` (e.g., `architecture`) and `atlas_run_id` (timestamp). These let atlas recognize its own pages on re-runs.

**Examples:**

```text
# Fresh-wiki bootstrap with default comprehensive facets
/doc-wiki:atlas

# Show what would be generated, no writes
/doc-wiki:atlas --dry-run

# Cheap re-run focused on architecture pages only — won't delete data-model
# pages from a prior comprehensive run
/doc-wiki:atlas --facets architecture

# Single-topic refresh for incremental work
/doc-wiki:atlas --scope auth

# Unattended CI run with a larger cost ceiling
/doc-wiki:atlas --yes --max-cost 500
```

**See also:** [`SKILL.md` § /doc-wiki:atlas](../skills/doc-wiki/SKILL.md), [`atlas_orchestrator.ts`](../skills/doc-wiki/scripts/atlas_orchestrator.ts), [`atlas_gitlog.ts`](../skills/doc-wiki/scripts/atlas_gitlog.ts), [`atlas_validate.ts`](../skills/doc-wiki/scripts/atlas_validate.ts), [`atlas_synthesize.ts`](../agents/lib/atlas_synthesize.ts).

---

### `/doc-wiki:ingest` — Fetch, extract, compile

Ingest a source (file, URL, folder, or pasted text) into the wiki. The bread-and-butter command — most days you'll spend most of your time here.

**Synopsis:** `/doc-wiki:ingest <source> [--wiki-root <path>] [--output <relative-path>] [--no-crosslink] [--no-tag-harmonize]`

**Args:**

| Arg | Type | Default | Purpose |
|---|---|---|---|
| `<source>` | string | **required** | File path, URL, folder, or pasted-text marker (e.g. `-` to read stdin) |
| `--wiki-root` | path | `./wiki` | Path to the wiki created by `/doc-wiki:init` |
| `--output` | path | (inferred) | Wiki-relative path to write the compiled page to. When absent, the destination is inferred from content (existing behavior). Used by `/doc-wiki:atlas` to pin per-topic destinations. |
| `--no-crosslink` | flag | (off) | Skip the post-op crosslink pass |
| `--no-tag-harmonize` | flag | (off) | Skip the post-op tag-harmonize pass |

**What it does:**

The 13-step pipeline (full diagram in [`architecture.md`](architecture.md#diagram-2-wiki-ingest-pipeline)):

1. Parse `wiki.config.yaml` to find the wiki root.
2. Check the SHA256 cache to skip already-ingested content.
3. Run a security check (URL validation, path containment).
4. Extract the source (binary, multimodal, archive, or plain text).
5. Read the source completely.
6. Surface 3–5 takeaways and an entity list.
7. Call `gather()` from `narai-primitives` to fetch related context from any enabled connectors.
8. Compile the wiki page(s) — frontmatter, claims metadata, code references with content hashes.
9. Augment with Mermaid diagrams via `mermaid_augment.ts`.
10. Generate "How to Go Deeper" hints — one bullet per source class.
11. Update `wiki/index.md` and `wiki/summaries.md`.
12. Append the operation to `log/events.jsonl`.
13. Run post-op hooks (crosslink + tag-harmonize, if 3+ pages).

A folder ingest runs the pipeline once per file, with checkpoint support — interrupt and resume safely.

**Examples:**

```text
/doc-wiki:ingest README.md
/doc-wiki:ingest src/auth/
/doc-wiki:ingest https://your-org.atlassian.net/browse/AUTH-123
/doc-wiki:ingest https://github.com/narailabs/doc-wiki
/doc-wiki:ingest /path/to/design-spec.pdf --no-tag-harmonize
```

**See also:** [`SKILL.md` § /doc-wiki:ingest](../skills/doc-wiki/SKILL.md), [`connectors.md`](connectors.md), [`architecture.md`](architecture.md#diagram-2-wiki-ingest-pipeline).

---

### `/doc-wiki:refresh` — Re-fetch and update

Re-fetch previously ingested sources, diff against stored versions, re-compile changed pages.

**Synopsis:** `/doc-wiki:refresh [--source <source>] [--all] [--wiki-root <path>]`

**Args:**

| Arg | Type | Default | Purpose |
|---|---|---|---|
| `--source` | string | (none) | A single previously ingested source to refresh |
| `--all` | flag | (off) | Refresh every source recorded in `log/events.jsonl` |
| `--wiki-root` | path | `./wiki` | Path to the wiki |

Either `--source` or `--all` must be given.

**What it does:**

- Reads `log/events.jsonl` to find recorded sources.
- For each, re-fetches (using whichever connector originally fetched it) and computes a content hash.
- If unchanged, skips. If changed, re-compiles the affected wiki page(s) with a diff log.
- Supports checkpoint resume on `--all`.

**Examples:**

```text
/doc-wiki:refresh --source https://your-org.atlassian.net/browse/AUTH-123
/doc-wiki:refresh --all
```

**See also:** [`SKILL.md` § /doc-wiki:refresh](../skills/doc-wiki/SKILL.md).

---

## Search

### `/doc-wiki:query` — Summary-first search, synthesis, and shortest-path

Two modes — picked by argument shape:

- **Synthesis mode** (default): natural-language question → summary-first search → synthesized answer.
- **Path mode** (`--from` and `--to` instead of a question): shortest-path traversal over `graph/edges.jsonl`.

#### Synopsis

```text
/doc-wiki:query <question> [--wiki-root <path>] [--max-depth <N>]
/doc-wiki:query --from <a> --to <b> [--max-hops <N>] [--via <c>] [--all-paths] [--wiki-root <path>]
```

#### Synthesis-mode args

| Arg | Type | Default | Purpose |
|---|---|---|---|
| `<question>` | string | **required** | Natural-language question |
| `--wiki-root` | path | `./wiki` | Path to the wiki |
| `--max-depth` | integer | `3` (from config) | Maximum hop depth for link-following |

What it does:

1. Reads `wiki/summaries.md` (one ~50-token summary per page).
2. Scores each summary against the question.
3. Loads the top-N matching pages.
4. Follows their inline links up to `max_depth` hops.
5. Synthesizes an answer from the loaded content.
6. Surfaces gaps (questions the wiki couldn't answer).
7. Archives the full transcript under `outputs/queries/<timestamp>.md` for later `/doc-wiki:promote`.

#### Path-mode args

| Arg | Type | Default | Purpose |
|---|---|---|---|
| `--from` | string | **required** | Starting concept (page slug or page title) |
| `--to` | string | **required** | Ending concept |
| `--max-hops` | integer | `5` | Limit on path length |
| `--via` | string | (none) | Force the path to pass through this concept |
| `--all-paths` | flag | (off) | Return up to 5 simple paths in DFS order (`Edge[][]`) instead of the single shortest path. `--max-hops` and `--via` are ignored in this mode. |

What it does: calls `graph_ops.ts path` with the given args. Edge types include `supports`, `contradicts`, `extends`, `supersedes` — see [`references/quality.md`](../skills/doc-wiki/references/quality.md) for the full list. Path mode is read-only — no archive, no synthesis.

#### Examples

```text
# synthesis mode
/doc-wiki:query "How does authentication work?"
/doc-wiki:query "Where do we store session tokens?" --max-depth 5

# path mode
/doc-wiki:query --from auth --to session
/doc-wiki:query --from auth --to billing --via session --max-hops 4
/doc-wiki:query --from foo --to bar --all-paths
```

**See also:** [`SKILL.md` § /doc-wiki:query](../skills/doc-wiki/SKILL.md), [`graph_ops.ts`](../skills/doc-wiki/scripts/graph_ops.ts).

---

### `/doc-wiki:stats` — Token efficiency and cost metrics

Aggregate metrics from `log/events.jsonl`.

**Synopsis:** `/doc-wiki:stats [--since <duration>] [--wiki-root <path>] [--per-agent]`

**Args:**

| Arg | Type | Default | Purpose |
|---|---|---|---|
| `--since` | duration (e.g. `7d`, `24h`) | `30d` | Time window |
| `--wiki-root` | path | `./wiki` | Path to the wiki |
| `--per-agent` | flag | (off) | Break costs down by agent (orm, mermaid, claude-md, plus connector calls) |

**What it does:**

Reads `log/events.jsonl`, sums tokens / costs / counts by op and (optionally) agent, and prints a concise table.

**Examples:**

```text
/doc-wiki:stats
/doc-wiki:stats --since 7d --per-agent
```

**See also:** [`SKILL.md` § /doc-wiki:stats](../skills/doc-wiki/SKILL.md), [`event_logger.ts`](../skills/doc-wiki/scripts/event_logger.ts).

---

## Maintenance

### `/doc-wiki:lint` — Health check and auto-heal

Run structural checks and (optionally) auto-fix what's safe.

**Synopsis:** `/doc-wiki:lint [--wiki-root <path>] [--fix] [--check <name>]`

**Args:**

| Arg | Type | Default | Purpose |
|---|---|---|---|
| `--wiki-root` | path | `./wiki` | Path to the wiki |
| `--fix` | flag | (off) | Apply auto-fixes for categories that allow it |
| `--check` | string | (all) | Run only the named check (e.g. `broken_links`) |

**What it does:**

Runs every check listed in `lint.checks.structural` from `wiki.config.yaml`:

- `broken_links` — find links to nonexistent pages
- `missing_frontmatter` — pages without required frontmatter fields
- `orphan_pages` — pages with no inbound edges
- `index_coverage` — pages absent from `wiki/index.md`
- `code_ref_drift` — wiki pages whose referenced code's content hash changed
- `provenance_gaps` — edges missing provenance tags
- (and more — see [`references/quality.md`](../skills/doc-wiki/references/quality.md))

Then runs an LLM-driven quality pass via `quality_score.ts`. With `--fix`, applies auto-fixes for categories whose autonomy override is `auto_fix` (see [`autonomy section`](configuration.md#autonomy-section)).

**Examples:**

```text
/doc-wiki:lint
/doc-wiki:lint --fix
/doc-wiki:lint --check broken_links
```

**See also:** [`SKILL.md` § /doc-wiki:lint](../skills/doc-wiki/SKILL.md), [`lint_checks.ts`](../skills/doc-wiki/scripts/lint_checks.ts), [`quality_score.ts`](../skills/doc-wiki/scripts/quality_score.ts).

---

### `/doc-wiki:fix` — Quick targeted correction

Apply a focused fix to a single page with a diff preview.

**Synopsis:** `/doc-wiki:fix <page-path> <issue-description>`

**Args:**

| Arg | Type | Default | Purpose |
|---|---|---|---|
| `<page-path>` | path | **required** | Path to the wiki page (relative to wiki root) |
| `<issue-description>` | string | **required** | What's wrong, in a sentence or two |

**What it does:**

1. Reads the target page.
2. Asks the LLM to propose a fix matching the description.
3. Shows a diff (current vs proposed).
4. Applies the diff if you confirm (or auto-applies in `autonomous` / `auto` modes).
5. Re-runs lint on the fixed page.

**Examples:**

```text
/doc-wiki:fix wiki/auth/jwt.md "frontmatter is missing tags"
/doc-wiki:fix wiki/billing/invoices.md "the SQL example uses the old schema"
```

**See also:** [`SKILL.md` § /doc-wiki:fix](../skills/doc-wiki/SKILL.md).

---

### `/doc-wiki:promote` — Query answer to permanent page

Convert an archived `/doc-wiki:query` answer in `outputs/queries/` into a permanent wiki page. Has two modes: single (one archive at a time, with flexible target resolution) and review (bulk triage with per-item approval).

#### Single mode

**Synopsis:** `/doc-wiki:promote <target> [--topic <directory>]`

**Target resolution** — first match wins:

| Input | Resolution |
|---|---|
| `last`, `latest`, `last query`, `latest query` | Most-recent `outputs/queries/*.md` by mtime |
| Bare positive integer `N` | Nth most-recent (1-indexed) |
| Path (relative or absolute) | Use as-is |
| Single token | Filename substring match; ambiguous → list and ask |
| Empty | List recent + prompt |

Archives in `outputs/queries/.promoted/` and `outputs/queries/.deleted/` are excluded from "most-recent" resolution.

The slash form is the canonical, deterministic phrasing. Bare phrasings like `promote last query` (no slash) work best-effort while a doc-wiki conversation is in context.

**Args:**

| Arg | Type | Default | Purpose |
|---|---|---|---|
| `<target>` | see above | (empty → list-and-ask) | What to promote |
| `--topic` | directory | (auto) | Subdirectory under `wiki/` to place the new page |

**What it does:**

1. Resolves the target.
2. Reads the query archive.
3. Compiles a wiki page — frontmatter, claims, links, summary.
4. Writes to `wiki/<topic>/<slug>.md`.
5. Updates `wiki/index.md` and `wiki/summaries.md`.
6. Moves the source archive to `outputs/queries/.promoted/<filename>` (preserved for audit; excluded from future suggestions).
7. Runs post-op hooks (crosslink + tag-harmonize).

**Examples:**

```text
/doc-wiki:promote last query
/doc-wiki:promote latest --topic auth
/doc-wiki:promote 2
/doc-wiki:promote outputs/queries/2026-04-28T10-15.md
/doc-wiki:promote outputs/queries/2026-04-28T10-15.md --topic auth
```

#### Review mode

**Synopsis:** `/doc-wiki:promote --review [--since <duration>] [--limit <N>] [--topic <directory>]`

Bulk archive triage with per-item approval. Use this for periodic cleanup after several `/doc-wiki:query` answers have accumulated.

**Args:**

| Arg | Default | Purpose |
|---|---|---|
| `--review` | — | Switch from single to review mode |
| `--since` | none | Only archives newer than `<duration>` (e.g. `7d`, `24h`) |
| `--limit` | none | Cap candidates to N |
| `--topic` | auto | Topic for every promotion in this batch |

**What it does:**

For each candidate archive (oldest first), the orchestrator presents `[P]romote / [S]kip / [D]elete / [A]bort batch`. `P` runs the single-mode flow; `D` moves to `outputs/queries/.deleted/`; `A` stops the batch. The mode honors the configured autonomy level:

| Autonomy | Per-archive prompt | Already-covered handling |
|---|---|---|
| `conservative` | Always ask | Ask before promoting anyway |
| `balanced` (default) | Always ask | Auto-skip |
| `autonomous` | Auto-promote novel | Auto-skip |
| `auto` | Auto-promote novel | Auto-skip |

**Examples:**

```text
/doc-wiki:promote --review
/doc-wiki:promote --review --since 7d
/doc-wiki:promote --review --since 30d --limit 5 --topic ops
```

#### Periodic execution

Use the `/schedule` skill. For interactive review (default `balanced` autonomy), schedule a reminder:

```text
/schedule "Run /doc-wiki:promote --review --since 7d" "every Monday at 9am"
```

For unattended pipelines, set autonomy to `auto` and schedule the command directly — novel archives will be batch-promoted with no prompting.

**See also:** [`SKILL.md` § /doc-wiki:promote](../skills/doc-wiki/SKILL.md). The `/doc-wiki:lint` query-absorption pass uses the same coverage rule.

---

## Common patterns

A few command sequences you'll use often:

```text
# First-time setup
/doc-wiki:init
/doc-wiki:onboard
/doc-wiki:ingest README.md

# Ingest an entire codebase area
/doc-wiki:ingest src/auth/
/doc-wiki:ingest docs/auth-design.md
/doc-wiki:ingest https://your-org.atlassian.net/browse/AUTH-123

# Investigate something via the wiki
/doc-wiki:query "How is JWT validated?"
# (the answer is good — keep it)
/doc-wiki:promote last query --topic auth

# Periodic maintenance
/doc-wiki:lint --fix
/doc-wiki:promote --review --since 7d   # triage accumulated query archives
/doc-wiki:refresh --all
/doc-wiki:stats --since 7d --per-agent
```

For full procedural detail beyond this reference, the canonical source is [`SKILL.md`](../skills/doc-wiki/SKILL.md).
