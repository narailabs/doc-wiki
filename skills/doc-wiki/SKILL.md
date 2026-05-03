---
name: doc-wiki
description: Manage a documentation wiki — generate, ingest sources, query, lint, fix, promote, refresh. Triggers on requests about documentation, knowledge bases, archived queries, ORM mapping, or database schemas, including phrasings like "promote last query", "lint the wiki", or "fix the auth page".
---

# doc-wiki — Documentation Wiki Generator & Maintainer

You are an orchestrator for a multi-skill documentation ecosystem. Your job is to route `/doc-wiki:*` commands to the right combination of TypeScript scripts and sub-agents, compile wiki pages from multiple sources, and maintain the wiki's quality over time.

## How this works

1. The user invokes a `/doc-wiki:*` command (or describes what they want in natural language)
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

### /doc-wiki:init — Bootstrap a wiki

Create the directory scaffold and initial configuration.

```bash
node {skill_path}/scripts/init_wiki.js --path <wiki-root> --domain "<domain>" --name "<wiki-name>"
```

This creates: `wiki/`, `raw/`, `graph/`, `audit/`, `log/`, `outputs/`, `.wiki-cache/`, `.wiki-ignore`, and a default `wiki.config.yaml`.

After running the script, create initial files:
- `wiki/index.md` — master catalog (empty, will populate during ingest)
- `wiki/summaries.md` — enriched summary index (empty initially)
- `wiki/overview.md` — evolving big-picture synthesis

### /doc-wiki:onboard — Interactive onboarding Q&A

Interactive setup that detects the codebase ecosystem and configures wiki infrastructure. This is YOUR reasoning — not a script. Uses `parse_config.ts` for config I/O and dispatches `wiki-orm-agent` for ORM/database detection.

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

Detect the database engine yourself by reading these files (no subagent dispatch needed):

- Docker Compose services (`docker-compose.yml`, `compose.yaml`): image names like `postgres:`, `mysql:`, `mongo:`
- Connection strings in config files (`.env`, `application.properties`, `database.yml`, `settings.py`)
- ORM config (e.g., `DATABASES` dict in Django, `spring.datasource.url` in Spring Boot)

When live introspection is needed (verify schema matches code), run `gather({ prompt: "describe schema for <db>", consumer: "doc-wiki" })` — the `db` connector inside `narai-primitives` handles it via the policy gate. Present detected database(s) and connection details (redacted credentials). Ask user to confirm.

**Phase 4 — External services Q&A:**

Ask the user about each external source integration:

1. "Do you use **Jira** for issue tracking? If so, what project key(s)?"
2. "Do you use **Confluence** for documentation? If so, what space key(s)?"
3. "Do you use **GCP** (BigQuery, Cloud SQL, Pub/Sub)? Which services?"
4. "Do you use **AWS** (RDS, DynamoDB, S3)? Which services?"
5. "Do you use **Notion** for documentation or knowledge base?"
6. "Do you use **GitHub** wikis, discussions, or project boards?"

For each "yes", record the connector ID (e.g. `jira`, `confluence`) — these go into the enabled allowlist for `consumers.doc-wiki` in Phase 4b.

**Phase 4b — Set up connector access:**

`/doc-wiki:ingest` step 7 calls `gather()` from `narai-primitives`, which reads `~/.connectors/config.yaml` (user-global) and `./.connectors/config.yaml` (repo overlay) to know which connectors are enabled and how to authenticate. If neither file exists yet, walk the user through creating one.

1. **Check existence:**
   ```bash
   ls -1 ~/.connectors/config.yaml ./.connectors/config.yaml 2>/dev/null
   ```

2. **If both are missing** — bootstrap from the example:
   - Tell the user: "Your wiki needs `~/.connectors/config.yaml` to access the external services you enabled. I'll generate a starter from `.connectors/config.example.yaml`."
   - For each connector the user said "yes" to in Phase 4, ask one credential question:
     - **Jira/Confluence:** "Where does your Atlassian API token live? (env var name, keychain label, or file path)"
     - **GitHub:** "Where does your GitHub personal access token live?"
     - **Notion:** "Where does your Notion integration token live?"
     - **AWS:** "Use the default SDK credential chain (env / `~/.aws/credentials` / IAM role)? Or a specific profile?"
     - **GCP:** "Use Application Default Credentials? Or a service account key file?"
   - Compose the YAML and write it to `~/.connectors/config.yaml`. Include only the enabled connectors and a `consumers.doc-wiki` block listing them.
   - Verify the file parses by reading it back and looking for the expected `connectors` keys (no need to invoke `loadResolvedConfig()` from a one-shot script — a bad YAML file will be obvious).

3. **If at least one already exists** — just confirm the enabled connectors line up with the user's Phase 4 answers. Suggest edits if there's a gap (e.g., user said "yes Confluence" but no `confluence:` block exists). Never edit an existing config without explicit confirmation.

Once the file is in place, the user's `/doc-wiki:ingest <source>` calls will resolve credentials automatically via the connector's own credential loader — doc-wiki never reads or stores the secrets directly.

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
3. If wiki scaffold does not exist, run `/doc-wiki:init` automatically:
   ```bash
   node {skill_path}/scripts/init_wiki.js --path <wiki-root> --domain "<detected-domain>" --name "<project-name>"
   ```

**Output:** A fully configured `wiki.config.yaml` with language, framework, ORM profile, database, external sources, autonomy mode, and multimodal preference. Wiki scaffold created if it did not already exist.

### /doc-wiki:atlas — Full application documentation

Generate a comprehensive wiki for the entire codebase in one orchestrated pass: discover topics, ingest curated sources per topic × facet, synthesize global aggregation pages, validate existing content against current source state, produce drift/cost audit artifacts.

This is **a meta-orchestrator over `/doc-wiki:ingest`**. It does not replace the per-source ingest workflow — it batches it across all detected topics and facets, then runs a synthesis pass for the three global pages (`wiki/overview.md`, `wiki/integrations.md`, `wiki/deploy.md`) that aggregate per-topic content.

**Synopsis:**

```text
/doc-wiki:atlas [--facets <list>] [--scope <topic>] [--yes] [--dry-run]
                [--max-cost <usd>] [--since <duration>]
                [--validate-mode shallow|full] [--resume]
                [--wiki-root <path>]
```

| Flag | Default | Purpose |
|---|---|---|
| `--facets <list>` | `architecture,data-model,environments,api,operations` | Per-topic facets to generate. **Additive** — never deletes pages outside this set from prior runs. |
| `--scope <topic>` | (all detected) | Restrict to one topic for incremental runs. |
| `--yes` | off | Skip phase confirmation gates (CI/unattended). |
| `--dry-run` | off | Show planned ingests + cost estimate, write nothing. Validation pass still runs (read-only). |
| `--max-cost <usd>` | `200.00` | Abort pre-write if estimate exceeds. Re-run with explicit higher value to override. |
| `--since <duration>` | Smart default: timestamp of last `op: atlas` event in `events.jsonl`; else **all-time** (no `git log --since`). | Window for the gitlog drift scan. |
| `--validate-mode shallow\|full` | `shallow` | `shallow`: structural + gitlog + semantic on sampled pages. `full`: semantic on every existing atlas page. |
| `--resume` | off | Continue from `.wiki-checkpoint.json` (opName `"atlas"`) without prompting. |

**Phases:**

1. **Detect state** — call `node {skill_path}/scripts/atlas_orchestrator.js detect-state --wiki-root <root>`. Output JSON (`{state, atlas_pages, all_pages, last_run_id}`) drives the branch:
   - `state == "fresh"` → wiki is empty or has < 3 atlas-tagged pages and no prior `op: atlas` event. Skip Phase 5.
   - `state == "existing"` → wiki has ≥ 3 atlas pages AND prior atlas event. Run all phases.
   - `state == "hybrid"` → pages exist but no prior atlas event (manual ingests only). Existing-mode discovery; Phase 5's semantic check skips non-atlas pages (those lacking `atlas_run_id` frontmatter).

   At this point, also **mint the `atlas_run_id`** for the rest of the run — `YYYY-MM-DDTHH-MM-SS` — and reuse it for every artifact below (inventory, plan snapshot, drift report, cost report, gap report).

1b. **Inventory the repo** — call `node agents/lib/atlas_inventory.js generate --wiki-root <root> --repo-root <repo-root> --run-id <id>` once, before topic discovery. The manifest at `wiki/outputs/atlas/<run-id>/code-inventory.json` carries four buckets: `project_metadata` (name / version / language / runtime from `package.json`, `pyproject.toml`, `go.mod`, `Cargo.toml`); `orm_entities` (via the `wiki_orm` library); `rest_endpoints` (eighteen shipped profiles spanning Python / TypeScript / Java / Ruby / Go / PHP / C# / Rust / Elixir / Swift — see `agents/lib/rest_profiles/` — all run by default when REST detection is enabled); `code_clients` (`gather()` and `fetchWithCaps()` callsites). REST detection is opt-in via `ecosystem.rest.enabled: true` in `wiki.config.yaml` (default `false`); the CLI reads the flag automatically. Pass `--enable-rest` to force-enable regardless of config; restrict to a subset with `--rest-profiles <csv>` (e.g. `--rest-profiles express,fastapi`). **Custom profiles** authored inline in `wiki.config.yaml` under `ecosystem.rest.custom_profiles` are automatically loaded — same shape as the shipped YAMLs; custom names override shipped on collision so users can teach atlas about in-house frameworks without modifying doc-wiki. Endpoints from overlapping profiles are deduplicated by `(file, line, method, path)`. Consumers in this PR: Phase 8 gap-report (REST endpoints + clients without documentation). Reserved for follow-ups: Phase 4 cost-estimate, Phase 6 source heuristics, the `assembleX` helpers in `agents/lib/atlas_synthesize.ts`. Missing-manifest is non-fatal — every consumer falls back to its pre-inventory behavior.

2. **Discover topics** — union five signals into a deduplicated list:
   - **Code dirs**: enumerate top-level subdirs of `src/`, `app/`, `services/`, etc. Skip vendor / `node_modules` / `.git`.
   - **ORM domains**: dispatch `wiki-orm-agent` and group entities into topic candidates (e.g., `User` → `auth`; `Invoice` → `billing`).
   - **Existing wiki dirs**: list `wiki/<topic>/` subdirectories (excluding `wiki/outputs/` and similar).
   - **Gitlog churn**: `node {skill_path}/scripts/atlas_gitlog.js classify --wiki-root <root> --since <window> --topics <csv>` flags paths whose changes haven't propagated.
   - **Tooling / CLI repos** (`domain: tooling` in `wiki.config.yaml` AND a top-level `commands/` directory): also enumerate `commands/*.md` slugs as topic candidates so each slash-command can have its own per-command architecture page. The four audience-flavor pages (commands / configuration / getting-started / troubleshooting) are emitted as Phase 7 globals regardless — this signal only adds per-command topic depth.

   Canonicalize each topic name: lowercase-kebab-case, strip `-service`, `-svc`, `-module` suffixes. Deduplicate by canonical name.

3. **Confirm topics** — present the merged list with provenance (which signals contributed each topic). Under `balanced+`, ask "Generate atlas pages for these topics? [Y/n/edit]". Under `auto`/`autonomous`, proceed silently. With `--yes`, skip the prompt.

4. **Estimate cost**:
   - Build a `Plan` JSON: `{ topics, facets, entries: [{topic, facet, sources, output}], created_at }`. **Manifest-backed facets** — populate `entry.sources` for `data-model` and `api` from `node {skill_path}/scripts/atlas_orchestrator.js compute-sources --wiki-root <root> --run-id <id> --topics <csv>`. The CLI returns `{topic: {"data-model": [...], "api": [...]}}` from the Phase 1b inventory; an empty `{}` (manifest missing or no entries match a wanted topic) means fall back to the heuristics for those facets too. **Heuristic facets** — `architecture` → `src/<topic>/`; `environments` → `.env*`, `config/<topic>*`; `operations` → runbooks if present. Always use heuristics when a manifest source is empty for a `(topic, facet)` pair (e.g. ORM not detected, REST disabled, `--enable-rest` was off).
   - `node {skill_path}/scripts/atlas_orchestrator.js estimate-cost --wiki-root <root> --plan '<plan-json>'`.
   - Display the estimate; if `total_estimated_usd > --max-cost`, abort with a clear hint to re-run with a higher `--max-cost`.

5. **Validate existing** (skip when `state == "fresh"`):
   - **Structural**: for each atlas page, `node {skill_path}/scripts/atlas_validate.js structural --wiki-root <root> --page <page>`.
   - **Gitlog drift**: `node {skill_path}/scripts/atlas_gitlog.js classify --wiki-root <root> --since <since> --topics <csv>` returns `{stale_pages, uncovered_files, unrelated_files}`.
   - **Semantic**: for each atlas page (sampled if `--validate-mode shallow`, all if `full`), compute `pageHash = sha256(body)` and `sourceHash = sha256(concat(sources))`. Probe `atlas_validate.js cache-check`; on miss, read page + sources and ask yourself: "Does this page still accurately describe the source(s)? List divergences." Store the result via `atlas_validate.js cache-store`.
   - Merge findings into `wiki/outputs/atlas/<run-id>/drift-report.md`.

6. **Bootstrap / refresh** — for each plan entry not cached:
   - Save the plan snapshot first: `atlas_orchestrator.js save-plan --wiki-root <root> --run-id <id> --plan '<json>'`. The snapshot drives `--resume` so re-discovery doesn't change scope mid-run.
   - For `entry.facet == "data-model"`: dispatch `wiki-orm-agent` and write the result to `entry.output` with atlas frontmatter.
   - For other facets: dispatch `/doc-wiki:ingest <source-list> --output <entry.output> --no-crosslink --no-tag-harmonize` (defer post-op hooks to Phase 8).
   - For drift-flagged stale pages: dispatch `/doc-wiki:refresh --source <source>`.
   - For uncovered files matching a current-run topic (per autonomy mode): `/doc-wiki:ingest <file> --output <inferred>`.
   - Use `scripts/checkpoint.ts` with `opName: "atlas"` to record completed `(topic, facet)` pairs as `<topic>:<facet>`. On `--resume`, load the snapshot via `load-plan` and skip recorded pairs.

7. **Synthesize globals** — always regenerated, regardless of `--facets` and `--scope`. **Seven global pages**, in this order; each carries `atlas_facet: <slug>` plus the run id in frontmatter, and a default `audience` derived from the slug (see `references/compilation.md` "Additional frontmatter for atlas pages"):
   - `wiki/overview.md` (audience: `contributor`): `node agents/lib/atlas_synthesize.js overview --wiki-root <root>` returns a JSON bundle (`{sources, text, notes}`) prefixed with an audience-routing table. LLM-synthesize the master architecture narrative.
   - `wiki/integrations.md` (audience: `integrator`): `atlas_synthesize.js integrations --wiki-root <root>`. Integration-keyword detection is data-driven from `BUILTIN_PATTERNS` (in `agents/lib/source_registry.ts`) plus a curated SaaS list — adding a connector via `wiki.config.yaml`'s `ecosystem.agents.custom` automatically extends the scan. LLM-synthesize the external-services map.
   - `wiki/deploy.md` (audience: `integrator`): `atlas_synthesize.js deploy --wiki-root <root>`. Hand the bundle to `/doc-wiki:ingest <synthetic-source> --output wiki/deploy.md`.
   - `wiki/commands.md` (audience: `operator`): `atlas_synthesize.js commands --repo-root <root>` walks `commands/*.md` plus `### /` headings from any `SKILL.md`. LLM-synthesize a synopsis-table-per-command operator reference.
   - `wiki/configuration.md` (audience: `operator`): `atlas_synthesize.js configuration --repo-root <root>` walks top-level config files (`wiki.config.yaml`, `*.config.*`, `.env.example`, `pyproject.toml`, …) plus `config/` and `.connectors/` directories. LLM-synthesize a configuration schema reference.
   - `wiki/getting-started.md` (audience: `new-user`): `atlas_synthesize.js getting-started --repo-root <root>` walks README + `package.json` scripts + bootstrap files (`setup.sh`, `Makefile`, …). LLM-synthesize a numbered first-run walkthrough.
   - `wiki/troubleshooting.md` (audience: `debugger`): `atlas_synthesize.js troubleshooting --wiki-root <root>` walks recent error events from `events.jsonl` plus the latest atlas drift report. LLM-synthesize symptom → cause → fix triplets.

8. **Finalize**:
   - Run `/doc-wiki:lint` (no `--fix`) and append findings to the drift report.
   - **Cross-doc-ownership scan**: `node {skill_path}/scripts/atlas_validate.js cross-doc --wiki-root <root>` flags pairs of architecture pages that share both ≥1 source path AND ≥1 Mermaid diagram title. Surface as drift findings — one page should own each shared concept (mirrors the "Cross-doc concerns" registry pattern in `docs/README.md`).
   - **Gap report**: `node {skill_path}/scripts/atlas_orchestrator.js gap-report --wiki-root <root> --plan '<json>' --run-id <id> --gitlog '<json>'` writes `wiki/outputs/atlas/<run-id>/gap-report.md` enumerating topics-without-pages, facets-without-coverage, source-files-with-no-page, gitlog-uncovered-files, external-services-without-documentation, and (when the Phase 1b inventory manifest is present at the canonical path) REST-endpoints-without-documentation + code-clients-without-documentation. Always emitted; non-empty sections are actionable items for a follow-up `--scope` ingest.
   - Update `wiki/index.md` (re-list all atlas pages by facet).
   - Run global crosslink + tag-harmonize over the entire wiki.
   - `node {skill_path}/scripts/event_logger.js log --op atlas --wiki-root <root> --details '<json>'` with fields: `atlas_run_id`, `phase_durations`, `total_cost_usd`, `pages_generated`, `pages_refreshed`, `pages_drifted`, `topics_covered`.
   - Clear the checkpoint via `clearCheckpoint(wikiRoot, "atlas")`.
   - Write `wiki/outputs/atlas/<run-id>/cost-report.md` with the planned breakdown from `estimate-cost` plus actual costs from this run's events.

**Atlas frontmatter conventions** — every atlas-generated page carries two extra fields beyond the standard set:

- `atlas_facet`: one of `architecture`, `data-model`, `environments`, `api`, `operations`, `overview`, `integrations`, `deploy`.
- `atlas_run_id`: timestamp of the generating atlas run (`YYYY-MM-DDTHH-MM-SS`).

These let atlas recognize its own pages on re-runs and skip semantic-cache invalidation when nothing changed.

**Page template** — every atlas page targets 300–800 lines, splits to sibling subpages beyond, starts with a TL;DR, and ends with auto-managed cross-links. The body section is **facet-conditional** so each audience gets the structure it needs.

```text
---
<frontmatter incl. atlas_facet, atlas_run_id, sources, summary, audience>
---

# <Title>

## TL;DR
<3–5 sentences>

<body sections — see facet table below>

## How to Go Deeper
<links to deeper sources or sibling pages>

## Related Pages
<auto-managed by crosslink hook>
```

**Body sections by facet** (the LLM should follow these structural conventions; they mirror the patterns documented in `docs/architecture.md`, `docs/commands.md`, `docs/troubleshooting.md`):

| Facet | Audience | Body sections (mandatory unless noted) |
|---|---|---|
| `architecture` | `contributor` | A layered model section + Mermaid `flowchart` or `sequenceDiagram` + `## Architecture contracts` (numbered load-bearing invariants) |
| `data-model` | `contributor` | Summary-metrics table + entity↔table mapping + `erDiagram` (mandatory) + unmapped-tables list |
| `environments` | `contributor` | Per-env table + secret-resolution rules + network topology |
| `api` | `integrator` | Per-endpoint synopsis + request/response samples + `sequenceDiagram` (recommended) |
| `operations` | `operator` | Runbook with triggers + recovery steps + escalation contacts |
| `commands` | `operator` | Per-command `## /<command>:<sub>` with synopsis + args table + examples (shell blocks) |
| `configuration` | `operator` | One `## <filename>` heading per config file (with a `field \| type \| default \| meaning` table). Then a top-level `## Credential reference grammar` heading (table mapping schemes — `env:`, `keychain:`, `file:`, `cloud:aws-secret/`, `cloud:gcp-secret/` — to resolution targets). Then a top-level `## Resolution order` heading (numbered list, most-specific-wins). Then a top-level `## Worked example`. Subsections like "credential grammar" must NOT live inside the per-file headings — keep them top-level so readers can link directly. |
| `getting-started` | `new-user` | Numbered prereq → install → first-command walkthrough |
| `troubleshooting` | `debugger` | `### Symptom / ### Cause / ### Fix` triplets, one per common failure mode |
| `overview` | `contributor` | Audience-routing table at top, then a layered architecture narrative |
| `integrations` | `integrator` | Per-service subsection: credentials + actions + sample CLI |
| `deploy` | `integrator` | Per-target build/deploy sequence + environment matrix |

The `audience` frontmatter drives the section choice; the `atlas_facet` drives which Mermaid diagrams are mandatory (per `quality_score.ts` `MERMAID_EXPECTED_TAGS`). When an existing page contradicts this template (e.g., an `architecture` page with `### Symptom` headings), Phase 5 surfaces it as a structural drift finding.

**Additive re-runs invariant**: pages from prior runs are NEVER deleted by a smaller-`--facets` re-run. Validation (Phase 5) runs on every existing atlas page regardless of current `--facets`. (Re-)generation (Phase 6) only touches facets in the current `--facets` set that are stale or missing.

**Drift handling** honors `autonomy.mode` from `wiki.config.yaml`:

| Autonomy | Stale (gitlog) | Structural | Semantic | Uncovered files |
|---|---|---|---|---|
| `conservative` | Ask before refresh | Report only | Report only | Ask before ingest |
| `balanced` (default) | Auto-refresh | Auto-fix safe; report structural | Report; ask | Auto-ingest if matches current topic; else report |
| `autonomous` / `auto` | Auto-refresh | Auto-fix all | Auto-fix; ask on conflicts | Auto-ingest |

**Cost ceiling**: pre-run estimate aborts if over `--max-cost`. Mid-run, if cumulative actual exceeds `1.5 × --max-cost`, finish the current page, save checkpoint, abort gracefully.

**Partial failures — continue, don't halt**: `gather()` already isolates per-step errors; `/doc-wiki:ingest` errors on a single source are skipped (logged to drift report); LLM timeouts retry once with backoff. Only disk/permission errors hard-abort. Always save the checkpoint before any abort.

**Cancellation (Ctrl+C)**: in-flight LLM call finishes (can't kill cleanly); checkpoint saved; resume hint printed. Re-run `/doc-wiki:atlas --resume` to continue.

### /doc-wiki:ingest — Fetch + Extract + Compile

Ingest sources into the wiki. The source can be a file, URL, folder, or pasted text.

1. **Parse config:** `node {skill_path}/scripts/parse_config.js --config <wiki-root>/wiki.config.yaml`
2. **Check cache:** `node {skill_path}/scripts/cache_manager.js check --path <source-path> --cache-dir <wiki-root>/.wiki-cache/`
3. **Extract** (if binary): `node {skill_path}/scripts/extract_binary.js --input <file> --output <raw-dir>/extracted/` for `.pdf` / `.docx` / `.pptx`. For image / audio / video / YouTube inputs, call `node {skill_path}/scripts/extract_multimodal.js <input> --enabled <from-config>` instead. When it returns `format: "skipped"`, surface the `warning` verbatim to the user (it names the missing tool and the exact install command) and continue with the rest of the ingest — do NOT abort the batch. For `format: "vision"`, use the `Read` tool directly on the image path and write notes to `raw/<topic>/images/<name>.md`. For `format: "audio_video"` and `"youtube"`, the dispatcher tells you which tool to invoke next (`faster-whisper`, or `yt-dlp | faster-whisper`); run it with the domain-aware prompt seeded from `graph_ops.godNodes()`.
4. **Security check:** `node {skill_path}/scripts/security_check.js --url <url>` (for URL sources)
5. **Read the source fully** — no skipping sections
6. **Surface 3-5 takeaways + entity list** — your reasoning
7. **Gather context via `narai-primitives`** — a single library call replaces per-agent dispatch:

   ```ts
   import { gather } from "narai-primitives";
   import { applyMermaid } from "../agents/lib/mermaid_augment.js";

   const { plan, results } = await gather({
     prompt: "<takeaways + entity list from step 6>",
     consumer: "doc-wiki",
   });
   const augmented = results.map(applyMermaid);
   ```

   The hub reads `~/.connectors/config.yaml` (with `consumers.doc-wiki` overrides applied), asks the Claude Agent SDK for a plan over the enabled connectors, and dispatches each step in parallel as a connector-CLI subprocess. Errors are isolated per step — `results[i].error` carries a structured `{ code, message }` instead of throwing. `applyMermaid` (in `agents/lib/mermaid_augment.ts`) walks each result and, for the seven structural-action connectors (aws, gcp, jira, confluence, notion, github, db), augments the envelope with a `mermaid: { type, title, code }` block — exactly the same shape the per-agent wrappers used to produce. The augmented `results` array is what step 8 consumes.

   Per-call setup lives in `~/.connectors/config.yaml`; doc-wiki-specific overrides go under `consumers.doc-wiki` (e.g. enabled connector allowlist, per-connector option overrides). No code change is needed to add or disable a connector — just edit the config.
8. **Compile into wiki page(s)** — read `references/compilation.md` for rules on frontmatter, linking, code locality, claims extraction. **`--output <relative-path>` flag**: when present, write the compiled page to the given wiki-relative path verbatim instead of inferring a topic/slug from content. Used by `/doc-wiki:atlas` to pin per-topic destinations (e.g., `wiki/auth/architecture.md`) and by direct calls like `/doc-wiki:ingest Dockerfile --output wiki/deploy.md`. Backward compatible — content-based inference remains the default when the flag is absent.
9. **Auto-generate Mermaid diagrams** — write the augmented envelopes from step 7 to a temp JSON file (one envelope per array entry, same `mermaid: {type, title, code}` shape as before) and splice each into the compiled page:

   ```bash
   node {skill_path}/scripts/mermaid_inject.js --page <wiki-page.md> --agents <agent-outputs.json> --in-place
   ```

   The injector is idempotent — wraps blocks in `<!-- wiki-mermaid: <title> start/end -->` markers so a second ingest replaces stale diagrams in place instead of stacking duplicates. Envelopes whose `applyMermaid` step did not attach a `mermaid` field are skipped silently.
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
12. **Log:** `node {skill_path}/scripts/event_logger.js --op ingest --source <source> --wiki-root <wiki-root> --details '<json>'`. When the op dispatched sub-agents, include them in `details.agent_calls[]` with shape `{agent, model, tokens_in, tokens_out, cost_usd, elapsed_ms, status}` — event_logger fills in `total_tokens_in`, `total_tokens_out`, and `total_cost_usd` automatically, and `/doc-wiki:stats` aggregates per-agent cost from those entries.
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

The checkpoint file is `<wikiRoot>/.wiki-checkpoint.json`, keyed by opName. If the batch is interrupted, re-running `/doc-wiki:ingest <same-folder>` picks up where it stopped.

### /doc-wiki:query — Summary-first search + synthesis

Two modes — picked by argument shape:

- **Synthesis mode** (positional `<question>`): the default flow, steps 1–8 below.
- **Path mode** (`--from <a> --to <b>` instead of a question): shortest-path traversal over `graph/edges.jsonl`. Skips steps 1–6.

#### Synthesis mode

1. Read `wiki/summaries.md` (one file, ~50 tokens per page)
2. Score relevance of all page summaries against the question
3. Load top-N full pages (typically 3-5)
4. Follow links up to 5 levels deep
5. Synthesize answer with inline citations
6. Surface contradictions and knowledge gaps
7. Archive answer to `outputs/queries/`
8. Offer to promote to wiki page via `/doc-wiki:promote`

Log token efficiency: `node {skill_path}/scripts/event_logger.js --op query --wiki-root <wiki-root> --details '{"tokens_in": N, "tokens_out": M, "reduction_ratio": R}'`

#### Path mode

```bash
node {skill_path}/scripts/graph_ops.js path --from "<concept-a>" --to "<concept-b>" --edges <wiki-root>/graph/edges.jsonl
```

Returns the typed-edge chain connecting two concepts. Supports `--max-hops`, `--via`, `--all-paths`. Read-only — no autonomy gate, no archive, no synthesis.

### /doc-wiki:lint — Health check + auto-heal

Run structural checks via script, then LLM-driven checks yourself:

```bash
node {skill_path}/scripts/lint_checks.js --wiki-root <wiki-root>
```

The script reports: broken links, missing frontmatter (including page-type enum), orphan pages, isolated nodes, code-ref drift, provenance completeness, stale content (>90 days via `--stale-days N`). Then YOU do: factual contradictions, terminology consistency, missing coverage, query absorption.

**Query absorption:** after the structural pass, scan `outputs/queries/*.md` (skipping `outputs/queries/.promoted/` and `outputs/queries/.deleted/`) for archived answers that contain insights not yet captured in any wiki page. For each novel insight, propose (per autonomy mode) either (a) a `/doc-wiki:fix` on the most relevant existing page, or (b) a `/doc-wiki:promote` of the archived query. For a focused archive-only triage flow (without the rest of lint), use `/doc-wiki:promote --review` — same coverage rule, different entry point.

**Anti-repetition memory:** run `node {skill_path}/scripts/summaries_rebuild.js --wiki-root <root>` — the rebuilder pulls deprecated claims' `failure_reason` fields via `banlist.buildBanlistSection()` and splices them into `wiki/summaries.md` under `## Anti-repetition Memory`. This prevents future ingests from re-exploring abandoned directions. (For the section in isolation, `banlist.js build --wiki-root <root>` still prints it to stdout.)

Read `references/quality.md` for scoring rules and `references/autonomy.md` for how to decide what to auto-fix vs ask the user.

### /doc-wiki:fix — Quick corrections

1. User identifies the page and issue
2. Read the page
3. Show diff (current vs proposed)
4. Apply if autonomy mode permits
5. Log + run post-op hooks

### /doc-wiki:promote — Query answer -> wiki page

Two modes — picked by argument shape:

- **Single mode** (default): convert one archived query answer into a permanent wiki page.
- **Review mode** (`--review`): bulk-triage many archived answers in one pass with per-item approval.

#### Target resolution (single mode)

Resolve the target argument with the first matching rule:

| Input form | Resolution |
|---|---|
| `last`, `latest`, `last query`, `latest query` | Most-recent `outputs/queries/*.md` by mtime |
| Bare positive integer `N` | Nth most-recent (1-indexed; `1` == latest) |
| Existing path (relative or absolute) | Use as-is |
| Single token, no path | Match by filename substring; if 0 or >1 match, list candidates and ask |
| Empty | List recent + prompt the user to pick |

Pick by mtime via `ls -1t <wiki-root>/outputs/queries/*.md`. Always exclude `outputs/queries/.promoted/` and `outputs/queries/.deleted/` — these subdirs hold archives that were already triaged.

The slash form `/doc-wiki:promote last query` is the canonical, deterministic phrasing. The bare form (typed without the slash, e.g. `promote last query`) is best-effort — the skill description's keyword set covers it, but ambiguous contexts may need a clarifying turn.

#### Single-mode flow

1. Resolve the target.
2. Read the query archive.
3. Compile a wiki page — frontmatter, claims, links, summary; convert inline citations to relative markdown links.
4. Write to `wiki/<topic>/<slug>.md` (`--topic` overrides; otherwise infer from content).
5. Update `wiki/index.md` and `wiki/summaries.md`.
6. Move the source archive to `outputs/queries/.promoted/<filename>` so it is not re-suggested by `--review` or by `/doc-wiki:lint` query-absorption.
7. Run post-op hooks (crosslink + tag-harmonize).

#### Review mode (`--review`)

```
/doc-wiki:promote --review [--since <duration>] [--limit <N>] [--topic <directory>]
```

Bulk archive triage with per-item approval. `--since` filters by mtime (e.g. `7d`, `24h`); `--limit` caps candidates; `--topic` overrides topic for every promotion in this batch.

For each candidate (oldest first, skipping `.promoted/` and `.deleted/`):

1. Read title + first ~30 lines of the archive.
2. Run the same coverage check `/doc-wiki:lint` query-absorption uses: is this insight already on a wiki page?
3. If covered → skip silently (or in `conservative`, ask "Already covered by `<page>`. Promote anyway?").
4. If novel → present `[P]romote / [S]kip / [D]elete archive / [A]bort batch`.
5. On `P` → run the single-mode flow (steps 1-7 above) for this archive.
6. On `D` → move to `outputs/queries/.deleted/<filename>`. Never `rm` — preserve for audit.
7. On `A` → stop, summarize what was done so far.

End the run with one line: `<X> promoted, <Y> skipped, <Z> deleted, <W> already-covered`.

#### Autonomy interaction

| Mode | Per-archive prompt | "Already covered" |
|---|---|---|
| `conservative` | Always ask P/S/D/A | Ask before promoting anyway |
| `balanced` (default) | Always ask P/S/D/A | Auto-skip |
| `autonomous` | Auto-promote novel; ask only on conflicts | Auto-skip |
| `auto` | Auto-promote novel; auto-skip everything | Auto-skip |

`balanced` is the "individual user approval" workflow.

#### Periodic execution

For interactive `balanced`/`conservative` use, schedule a *reminder* with the `/schedule` skill rather than an unattended run:

```
/schedule "Run /doc-wiki:promote --review --since 7d" "every Monday at 9am"
```

For unattended pipelines, set autonomy to `auto` and schedule the command directly — the orchestrator will batch-promote novel archives without prompting.

See also: `/doc-wiki:lint` query-absorption (above) — same coverage rule, different entry point.

### /doc-wiki:refresh — Re-fetch and update from original sources

Re-fetch previously-ingested sources, diff against stored versions, re-compile changed pages.

**Batch resumption:** use `scripts/checkpoint.ts` with opName `"refresh"` the same way `/doc-wiki:ingest` uses it for folder sources — each source URL becomes a unit, and an interrupted refresh picks up at the next unfinished source on re-invocation. See `/doc-wiki:ingest` above for the pattern.

### /doc-wiki:stats — Token efficiency and cost metrics

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

`/doc-wiki:ingest` step 7 dispatches via `narai-primitives`'s `gather()` — one library call plans and spawns the bundled connector CLIs in parallel. There are no per-service wrapper scripts or subagents in doc-wiki; the legacy `wiki-<svc>-agent` folders were removed because they only duplicated the hub's CLI resolution and the `mermaid_augment.ts` decoration. Add a new builtin connector by adding an entry to `BUILTIN_PATTERNS` in `source_registry.ts`. Add an out-of-tree connector via `wiki.config.yaml`'s `ecosystem.agents.custom` block.

## Reference files

Read these as needed — don't load them all upfront:

- `references/operations.md` — Detailed specs for each operation, onboarding flow, edge cases
- `references/compilation.md` — Compilation rules: frontmatter schema, link enrichment, cross-referencing, code locality, claims extraction, "How to Go Deeper" generation
- `references/quality.md` — Quality scoring rules, tag philosophy, content-only tags, Mermaid lint
- `references/autonomy.md` — 4 autonomy modes (conservative/balanced/autonomous/auto), per-category overrides, decision flow
- `references/code-locality.md` — When to reference code vs copy it, content_hash drift detection
