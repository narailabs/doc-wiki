---
name: wiki
description: |
  Generate and maintain a structured documentation wiki inside any codebase. Use this skill whenever the user wants to: create project documentation, build a knowledge base from code/docs/external sources, query existing documentation, lint and improve docs quality, map database schemas to code (ORM mapping), maintain CLAUDE.md files across submodules, or set up documentation infrastructure. Triggers on: /wiki-init, /wiki-onboard, /wiki-ingest, /wiki-query, /wiki-lint, /wiki-fix, /wiki-promote, /wiki-refresh, /wiki-path, /wiki-stats, or any request about "documentation wiki", "knowledge base", "doc generation", "ORM mapping", "database mapping".
---

# Wiki Skill — Documentation Wiki Generator & Maintainer

You are an orchestrator for a multi-skill documentation ecosystem. Your job is to route `/wiki-*` commands to the right combination of TypeScript scripts and sub-agents, compile wiki pages from multiple sources, and maintain the wiki's quality over time.

## How this works

1. The user invokes a `/wiki-*` command (or describes what they want in natural language)
2. You read `wiki.config.yaml` to understand the wiki's configuration
3. You call TypeScript scripts (compiled to JavaScript, invoked via `node`) for deterministic operations
4. You dispatch sub-agents (via Agent tool) for platform-specific source fetching
5. You use your own reasoning for compilation, cross-referencing, and quality decisions
6. Post-operation hooks (crosslink + tag-harmonize) run automatically after write operations

## Scripts location

All TypeScript scripts live at: `{skill_path}/scripts/` and are compiled to `.js` siblings via `npm run build`.

Before first use, install dependencies and build:
```bash
npm install
npm run build
```

Requires Node 20.

## Commands

### /wiki-init — Bootstrap a wiki

Create the directory scaffold and initial configuration.

```bash
node {skill_path}/scripts/init_wiki.js --path <wiki-root> --domain "<domain>" --name "<wiki-name>"
```

This creates: `wiki/`, `raw/`, `graph/`, `audit/`, `log/`, `outputs/`, `.wiki-cache/`, `.wiki-ignore`, and a default `wiki.config.yaml`.

After running the script, create initial files:
- `wiki/index.md` — master catalog (empty, will populate during ingest)
- `wiki/summaries.md` — enriched summary index (empty initially)
- `wiki/overview.md` — evolving big-picture synthesis

### /wiki-onboard — Interactive onboarding Q&A

Interactive setup that detects the codebase ecosystem and configures wiki infrastructure. This is YOUR reasoning — not a script. Uses `parse_config.ts` for config I/O and dispatches `wiki-orm-agent` and `wiki-db-agent` for detection.

**Phase 1 — Auto-detect language/framework:**

Scan the project root for build files and infer the stack:

| Marker file | Detection |
|---|---|
| `pom.xml`, `build.gradle` | Java (Maven / Gradle) |
| `requirements.txt`, `pyproject.toml`, `setup.py` | Python |
| `package.json` | Node.js / TypeScript |
| `Gemfile` | Ruby |
| `*.csproj`, `*.sln` | .NET / C# |
| `go.mod` | Go |
| `Cargo.toml` | Rust |

Present findings and ask user to confirm or correct.

**Phase 2 — Detect ORM:**

Dispatch `wiki-orm-agent` (via Agent tool) to scan for entity definitions matching shipped ORM profiles:

- **JPA:** `@Entity`, `@Table`, `@Column` annotations in `.java`/`.kt` files
- **SQLAlchemy:** `declarative_base()`, `Base = declarative_base()`, `mapped_column` in `.py` files
- **Django:** `models.Model` subclasses in `models.py` / `models/` directories
- **Prisma:** `schema.prisma` file with `model` definitions
- **TypeORM:** `@Entity()`, `@Column()` decorators in `.ts` files
- **Entity Framework:** `DbContext` subclasses, `[Table]` attributes in `.cs` files
- **ActiveRecord:** `ApplicationRecord` or `ActiveRecord::Base` subclasses in `.rb` files

Present detected ORM profile and entity count. Ask user to confirm.

**Phase 3 — Detect database:**

Dispatch `wiki-db-agent` (via Agent tool) to detect database engine from:

- Docker Compose services (`docker-compose.yml`, `compose.yaml`): image names like `postgres:`, `mysql:`, `mongo:`
- Connection strings in config files (`.env`, `application.properties`, `database.yml`, `settings.py`)
- ORM config (e.g., `DATABASES` dict in Django, `spring.datasource.url` in Spring Boot)

Present detected database(s) and connection details (redacted credentials). Ask user to confirm.

**Phase 4 — External services Q&A:**

Ask the user about each external source integration:

1. "Do you use **Jira** for issue tracking? If so, what project key(s)?"
2. "Do you use **Confluence** for documentation? If so, what space key(s)?"
3. "Do you use **GCP** (BigQuery, Cloud SQL, Pub/Sub)? Which services?"
4. "Do you use **AWS** (RDS, DynamoDB, S3)? Which services?"
5. "Do you use **Notion** for documentation or knowledge base?"
6. "Do you use **GitHub** wikis, discussions, or project boards?"

Enable corresponding source agents in config for each "yes" answer.

**Phase 5 — Choose autonomy mode:**

Present the four autonomy modes and ask user to choose:

- **conservative** — ask before every write
- **balanced** — auto-fix safe changes, ask for structural
- **autonomous** — auto-fix everything, notify after
- **auto** — choose per-operation based on risk score

Default: `balanced`.

**Phase 6 — Install hooks + scaffold:**

1. Offer to install PreToolUse always-on hooks for the detected platform

**Phase 6b — Optional multimodal deps (Q&A):**

Ask the user once, before writing the config:

> "Your wiki may ingest audio/video files (`.mp4`, `.mp3`, `.wav`, ...) or YouTube URLs later. The extraction uses two optional tools that aren't installed by default:
> - `faster-whisper` for local audio transcription (≈100 MB model on first use)
> - `yt-dlp` for downloading YouTube audio (single binary)
>
> Shall I help you set these up?
> - **Yes, both** → record `ecosystem.multimodal.enabled: on` and print exact install commands for the user's OS
> - **Yes, yt-dlp only** → record `on`; still print the `yt-dlp` install command (whisper will be skipped when triggered)
> - **No, skip for now** → record `ecosystem.multimodal.enabled: optional` (default); multimodal ingests will warn-and-skip until the user installs the tools later
> - **Never ask again** → record `ecosystem.multimodal.enabled: off`; multimodal ingests are silenced entirely"

When the user says yes, print the exact commands (but DO NOT run them — Claude cannot assume a package manager):
- macOS: `brew install yt-dlp` and `pipx install faster-whisper`
- Linux: `pipx install yt-dlp faster-whisper` (or the distro's package manager)
- Windows: `pipx install yt-dlp faster-whisper`

2. Generate/update `wiki.config.yaml` with all detected settings (including the `ecosystem.multimodal.enabled` choice from Phase 6b):
   ```bash
   node {skill_path}/scripts/parse_config.js --config <wiki-root>/wiki.config.yaml
   ```
3. If wiki scaffold does not exist, run `/wiki-init` automatically:
   ```bash
   node {skill_path}/scripts/init_wiki.js --path <wiki-root> --domain "<detected-domain>" --name "<project-name>"
   ```

**Output:** A fully configured `wiki.config.yaml` with language, framework, ORM profile, database, external sources, autonomy mode, and multimodal preference. Wiki scaffold created if it did not already exist.

### /wiki-ingest — Fetch + Extract + Compile

Ingest sources into the wiki. The source can be a file, URL, folder, or pasted text.

1. **Parse config:** `node {skill_path}/scripts/parse_config.js --config <wiki-root>/wiki.config.yaml`
2. **Check cache:** `node {skill_path}/scripts/cache_manager.js check --path <source-path> --cache-dir <wiki-root>/.wiki-cache/`
3. **Extract** (if binary): `node {skill_path}/scripts/extract_binary.js --input <file> --output <raw-dir>/extracted/` for `.pdf` / `.docx` / `.pptx`. For image / audio / video / YouTube inputs, call `node {skill_path}/scripts/extract_multimodal.js <input> --enabled <from-config>` instead. When it returns `format: "skipped"`, surface the `warning` verbatim to the user (it names the missing tool and the exact install command) and continue with the rest of the ingest — do NOT abort the batch. For `format: "vision"`, use the `Read` tool directly on the image path and write notes to `raw/<topic>/images/<name>.md`. For `format: "audio_video"` and `"youtube"`, the dispatcher tells you which tool to invoke next (`faster-whisper`, or `yt-dlp | faster-whisper`); run it with the domain-aware prompt seeded from `graph_ops.godNodes()`.
4. **Security check:** `node {skill_path}/scripts/security_check.js --url <url>` (for URL sources)
5. **Read the source fully** — no skipping sections
6. **Surface 3-5 takeaways + entity list** — your reasoning
7. **Cross-reference active agents** — consult the agent registry to determine which agents to dispatch:

   ```bash
   node {skill_path}/../agents/lib/source_registry.js list --agents-dir {skill_path}/../agents
   ```

   This outputs a JSON array of all registered agents (builtin + custom from `ecosystem.agents.custom` in wiki.config.yaml). For each enabled source/database agent, dispatch in parallel via Agent tool:

   ```
   Agent(
     subagent_type = "<agent.invocation_template.subagent_type>",
     model = "<agent.invocation_template.default_model>",
     prompt = "<constructed from agent's AGENT.md invocation contract>"
   )
   ```

   Custom agents registered in config work identically — the registry discovers them alongside builtins
8. **Compile into wiki page(s)** — read `references/compilation.md` for rules on frontmatter, linking, code locality, claims extraction
9. **Auto-generate Mermaid diagrams** — collect every dispatched agent's JSON `mermaid: {type, title, code}` envelope and splice each into the compiled page:

   ```bash
   node {skill_path}/scripts/mermaid_inject.js --page <wiki-page.md> --agents <agent-outputs.json> --in-place
   ```

   The injector is idempotent — wraps blocks in `<!-- wiki-mermaid: <title> start/end -->` markers so a second ingest replaces stale diagrams in place instead of stacking duplicates. Agents with no diagram output omit the `mermaid` field; the script skips them silently.
10. **Generate "How to Go Deeper" section** — from the page's final `sources:` frontmatter:

    ```bash
    node {skill_path}/scripts/how_to_go_deeper.js \
      --sources '<JSON-array-of-source-strings>' \
      --enabled <csv-of-enabled-agent-ids>
    ```

    Classifies each source against the agent registry (builtin + custom agents) and emits one bullet per entry with the exact agent command to run. Pass the enabled agents from `wiki.config.yaml` so disabled-agent hints are suppressed. Custom agents registered in `ecosystem.agents.custom` are included automatically. Elides when sources are all local `raw/...` already in the wiki body.
11. **Update indexes + summaries.md** — rebuild `wiki/summaries.md` deterministically:

    ```bash
    node {skill_path}/scripts/summaries_rebuild.js --wiki-root <wiki-root>
    ```

    Walks every page on disk, reads its frontmatter, emits one ~50-token summary per page, and splices the `## Anti-repetition Memory` section from `banlist.js`. Content outside the `<!-- wiki-managed: summaries start/end -->` markers is preserved. You still update `wiki/index.md` yourself (add a bullet to the new page's section).
12. **Log:** `node {skill_path}/scripts/event_logger.js --op ingest --source <source> --wiki-root <wiki-root> --details '<json>'`. When the op dispatched sub-agents, include them in `details.agent_calls[]` with shape `{agent, model, tokens_in, tokens_out, cost_usd, elapsed_ms, status}` — event_logger fills in `total_tokens_in`, `total_tokens_out`, and `total_cost_usd` automatically, and `/wiki-stats` aggregates per-agent cost from those entries.
13. **Run post-operation hooks** (crosslink + tag-harmonize) — see below

**Folder-source batches (checkpointing):** when the source is a folder (many files processed in a loop), use `scripts/checkpoint.ts` to make the batch resumable:

```ts
import { readCheckpoint, recordUnit, clearCheckpoint } from "{skill_path}/scripts/checkpoint.js";

const cp = readCheckpoint(wikiRoot, "ingest");
const done = new Set(cp?.completedIds ?? []);
for (const file of files) {
  if (done.has(file)) continue; // resume: skip already-processed units
  // ... run steps 2–12 for this file ...
  recordUnit(wikiRoot, "ingest", file);
}
clearCheckpoint(wikiRoot, "ingest");
```

The checkpoint file is `<wikiRoot>/.wiki-checkpoint.json`, keyed by opName. If the batch is interrupted, re-running `/wiki-ingest <same-folder>` picks up where it stopped.

### /wiki-query — Summary-first search + synthesis

1. Read `wiki/summaries.md` (one file, ~50 tokens per page)
2. Score relevance of all page summaries against the question
3. Load top-N full pages (typically 3-5)
4. Follow links up to 5 levels deep
5. Synthesize answer with inline citations
6. Surface contradictions and knowledge gaps
7. Archive answer to `outputs/queries/`
8. Offer to promote to wiki page via `/wiki-promote`

Log token efficiency: `node {skill_path}/scripts/event_logger.js --op query --wiki-root <wiki-root> --details '{"tokens_in": N, "tokens_out": M, "reduction_ratio": R}'`

### /wiki-lint — Health check + auto-heal

Run structural checks via script, then LLM-driven checks yourself:

```bash
node {skill_path}/scripts/lint_checks.js --wiki-root <wiki-root>
```

The script reports: broken links, missing frontmatter (including page-type enum), orphan pages, isolated nodes, code-ref drift, provenance completeness, stale content (>90 days via `--stale-days N`). Then YOU do: factual contradictions, terminology consistency, missing coverage, query absorption.

**Query absorption:** after the structural pass, scan `outputs/queries/*.md` for archived answers that contain insights not yet captured in any wiki page. For each novel insight, propose (per autonomy mode) either (a) a `/wiki-fix` on the most relevant existing page, or (b) a `/wiki-promote` of the archived query.

**Anti-repetition memory:** run `node {skill_path}/scripts/summaries_rebuild.js --wiki-root <root>` — the rebuilder pulls deprecated claims' `failure_reason` fields via `banlist.buildBanlistSection()` and splices them into `wiki/summaries.md` under `## Anti-repetition Memory`. This prevents future ingests from re-exploring abandoned directions. (For the section in isolation, `banlist.js build --wiki-root <root>` still prints it to stdout.)

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

**Batch resumption:** use `scripts/checkpoint.ts` with opName `"refresh"` the same way `/wiki-ingest` uses it for folder sources — each source URL becomes a unit, and an interrupted refresh picks up at the next unfinished source on re-invocation. See `/wiki-ingest` above for the pattern.

### /wiki-path — Shortest-path query between concepts

```bash
node {skill_path}/scripts/graph_ops.js path --from "<concept-a>" --to "<concept-b>" --edges <wiki-root>/graph/edges.jsonl
```

Returns the typed-edge chain connecting two concepts. Supports `--max-hops`, `--via`, `--all-paths`.

### /wiki-stats — Token efficiency and cost metrics

```bash
node {skill_path}/scripts/event_logger.js stats --wiki-root <wiki-root> --since 7d
```

Shows running averages, p50/p95 reduction ratios, total spend, per-agent cost breakdown. Per-agent cost sums top-level `agent` fields as well as every `agent_calls[]` sub-entry on every event, so parent-op events that dispatched sub-agents are fully accounted for.

## Post-Operation Hooks

After any write operation (ingest, fix, promote, refresh), run BOTH hooks if the wiki has >= 3 pages:

**Crosslink pass:** Read ALL wiki pages. Find meaningful relationships. Add 2-5 inline links per page. Add/update `## Related Pages` section on every page.

**Tag-harmonize pass:** Build tag vocabulary from all frontmatter. Scan each page's body. Add existing tags where missing. Only suggest new tags for concepts on 2+ pages. Enforce content-only tag philosophy (no structural/temporal/metadata tags). Target: 4-8 concept tags per page.

Skip hooks with `--no-crosslink` or `--no-tag-harmonize` flags.

## Quality scoring

After lint, compute quality scores:
```bash
node {skill_path}/scripts/quality_score.js --wiki-root <wiki-root>
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
