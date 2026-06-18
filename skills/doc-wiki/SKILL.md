---
name: doc-wiki
description: Manage the current codebase's doc-wiki — bootstrap with optional atlas (init), full-doc generation (atlas), source ingest from Jira/Confluence/GitHub/Notion/AWS/GCP/databases/files/URLs with `--refresh` for re-fetch (ingest), search + synthesis with promote-to-page and shortest-path modes (query), health check + self-heal (lint), targeted page edit (edit), restore an archived page (unarchive), token/cost metrics (stats). Always invoke when the user mentions "the wiki" or "the docs", or asks to set up doc-wiki, onboard this repo, ingest a URL into docs, refresh docs, look up something in the wiki, find a concept path, save the last query answer as a page, check wiki health, fix/edit a wiki page, restore an archived page, or see wiki cost metrics — even if "wiki" is not said explicitly. Slash commands — `/doc-wiki:init`, `:atlas`, `:ingest`, `:query`, `:lint`, `:edit`, `:unarchive`, `:stats`. Skip for unrelated docs work — arbitrary README edits, code comments, or general programming questions.
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

The wiki exposes 8 slash commands, dispatched by this section. Each subsection below documents the flow:

- `/doc-wiki:init` — scaffold + onboard (+ optional atlas chain)
- `/doc-wiki:atlas` — full application documentation
- `/doc-wiki:ingest` — fetch + extract + compile a source (`--refresh` re-fetches)
- `/doc-wiki:query` — summary-first search and synthesis (`--promote` saves an answer; `--review` triages archives)
- `/doc-wiki:lint` — health check + auto-heal
- `/doc-wiki:edit` — targeted page changes
- `/doc-wiki:unarchive` — restore an archived page from `wiki/_archive/`
- `/doc-wiki:stats` — token efficiency and cost metrics

### /doc-wiki:init — Bootstrap a wiki (scaffold + onboard + optional atlas)

This is the single first-run command. It scaffolds the wiki directory, runs the ecosystem onboarding Q&A, and offers to dispatch `/doc-wiki:atlas` at the end so a brand-new repo reaches a usable wiki in one invocation.

**Args:** `[--path <root>] [--domain <d>] [--name <n>] [--no-atlas | --atlas]`

`--atlas` and `--no-atlas` are mutually exclusive; passing both errors before any side effects.

**Phase 1 — Detect existing state.**
- If `<root>/wiki.config.yaml` exists: `AskUserQuestion` "Wiki already initialized. Re-run onboarding?". Skip Phase 2 (scaffold) either way; on "yes" continue to Phase 3 (onboarding Q&A); on "no" skip directly to Phase 4 (atlas decision).
- Otherwise: continue to Phase 2.

**Phase 2 — Scaffold.**

Create the directory scaffold and initial configuration.

```bash
node {skill_path}/scripts/init_wiki.js --path <wiki-root> --domain "<domain>" --name "<wiki-name>"
```

This creates: `wiki/`, `raw/`, `graph/`, `audit/`, `log/`, `outputs/`, `.wiki-cache/`, `.wiki-ignore`, and a default `wiki.config.yaml`.

**Default path inference (when `--path` is omitted):** Before invoking the script, derive a sensible default and confirm with the user via `AskUserQuestion`. Inference rule:

1. Read the project name from the first marker file present in the cwd: `package.json` (`name` field, strip `@scope/` prefix), then `pyproject.toml` (`[project] name` or `[tool.poetry] name`), then `Cargo.toml` (`[package] name`), then `go.mod` (last segment of `module` path), then `pom.xml` (`<artifactId>`), then `Gemfile`/`*.gemspec`, else fall back to `basename(cwd)`.
2. Convert the name to kebab-case: lowercase, replace runs of `[^a-z0-9]+` with `-`, strip leading/trailing `-`.
3. Default path = `docs/<kebab-name>-wiki/` (relative to cwd).

Always present this default to the user via `AskUserQuestion` with two options: (a) accept the default `docs/<kebab-name>-wiki/`, (b) "Other" → free-form path entry. Do NOT proceed silently to the script with an inferred path; init is a one-time scaffold and the path becomes a long-lived convention, so the explicit confirmation is worth the extra turn. Apply the same `AskUserQuestion` pattern for `--domain` (default: kebab-name) and `--name` (default: derived from the package's display name or kebab-name) when those are also omitted, but accept the inferred values as a single bundled question rather than three separate prompts.

The wrapper `commands/init.md` only routes into this skill — it does not pre-collect arguments. Arg collection happens here so the inference + confirmation logic stays co-located with the rest of the orchestrator.

After running the script, create initial files:
- `wiki/index.md` — master catalog (empty, will populate during ingest)
- `wiki/summaries.md` — enriched summary index (empty initially)
- `wiki/overview.md` — evolving big-picture synthesis

**Phase 3 — Onboarding Q&A.**

Interactive setup that detects the codebase ecosystem and configures wiki infrastructure. This is YOUR reasoning — not a script. Uses `parse_config.ts` for config I/O and dispatches `wiki-orm-agent` for ORM/database detection.

**Phase 3, step 1 — Auto-detect language/framework:**

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

**Phase 3, step 2 — Detect ORM:**

Dispatch `wiki-orm-agent` (via Agent tool) to scan for entity definitions matching shipped ORM profiles:

- **JPA:** `@Entity`, `@Table`, `@Column` annotations in `.java`/`.kt` files
- **SQLAlchemy:** `declarative_base()`, `Base = declarative_base()`, `mapped_column` in `.py` files
- **Django:** `models.Model` subclasses in `models.py` / `models/` directories
- **Prisma:** `schema.prisma` file with `model` definitions
- **TypeORM:** `@Entity()`, `@Column()` decorators in `.ts` files
- **Entity Framework:** `DbContext` subclasses, `[Table]` attributes in `.cs` files
- **ActiveRecord:** `ApplicationRecord` or `ActiveRecord::Base` subclasses in `.rb` files

Present detected ORM profile and entity count. Ask user to confirm.

**Phase 3, step 3 — Detect database:**

Detect the database engine yourself by reading these files (no subagent dispatch needed):

- Docker Compose services (`docker-compose.yml`, `compose.yaml`): image names like `postgres:`, `mysql:`, `mongo:`
- Connection strings in config files (`.env`, `application.properties`, `database.yml`, `settings.py`)
- ORM config (e.g., `DATABASES` dict in Django, `spring.datasource.url` in Spring Boot)

When live introspection is needed (verify schema matches code), run `gather({ prompt: "describe schema for <db>", consumer: "doc-wiki" })` — the `db` connector inside `narai-primitives` handles it via the policy gate. Present detected database(s) and connection details (redacted credentials). Ask user to confirm.

**Phase 3, step 4 — External services Q&A:**

Ask the user about each external source integration:

1. "Do you use **Jira** for issue tracking? If so, what project key(s)?"
2. "Do you use **Confluence** for documentation? If so, what space key(s)?"
3. "Do you use **GCP** (BigQuery, Cloud SQL, Pub/Sub)? Which services?"
4. "Do you use **AWS** (RDS, DynamoDB, S3)? Which services?"
5. "Do you use **Notion** for documentation or knowledge base?"
6. "Do you use **GitHub** wikis, discussions, or project boards?"

For each "yes", record the connector ID (e.g. `jira`, `confluence`) — these go into the enabled allowlist for `consumers.doc-wiki` in Phase 3, step 4b.

**Phase 3, step 4b — Set up connector access:**

`/doc-wiki:ingest` step 7 calls `gather()` from `narai-primitives`, which reads `~/.connectors/config.yaml` (user-global) and `./.connectors/config.yaml` (repo overlay) to know which connectors are enabled and how to authenticate. If neither file exists yet, walk the user through creating one.

1. **Check existence:**
   ```bash
   ls -1 ~/.connectors/config.yaml ./.connectors/config.yaml 2>/dev/null
   ```

2. **If both are missing** — bootstrap from the example:
   - Tell the user: "Your wiki needs `~/.connectors/config.yaml` to access the external services you enabled. I'll generate a starter from `.connectors/config.example.yaml`."
   - For each connector the user said "yes" to in Phase 3, step 4, ask one credential question:
     - **Jira/Confluence:** "Where does your Atlassian API token live? (env var name, keychain label, or file path)"
     - **GitHub:** "Where does your GitHub personal access token live?"
     - **Notion:** "Where does your Notion integration token live?"
     - **AWS:** "Use the default SDK credential chain (env / `~/.aws/credentials` / IAM role)? Or a specific profile?"
     - **GCP:** "Use Application Default Credentials? Or a service account key file?"
   - Compose the YAML and write it to `~/.connectors/config.yaml`. Include only the enabled connectors and a `consumers.doc-wiki` block listing them.
   - Verify the file parses by reading it back and looking for the expected `connectors` keys (no need to invoke `loadResolvedConfig()` from a one-shot script — a bad YAML file will be obvious).

3. **If at least one already exists** — just confirm the enabled connectors line up with the user's Phase 3, step 4 answers. Suggest edits if there's a gap (e.g., user said "yes Confluence" but no `confluence:` block exists). Never edit an existing config without explicit confirmation.

Once the file is in place, the user's `/doc-wiki:ingest <source>` calls will resolve credentials automatically via the connector's own credential loader — doc-wiki never reads or stores the secrets directly.

**Phase 3, step 5 — Choose autonomy mode:**

Present the four autonomy modes and ask user to choose:

- **conservative** — ask before every write
- **balanced** — auto-fix safe changes, ask for structural
- **autonomous** — auto-fix everything, notify after
- **auto** — choose per-operation based on risk score

Default: `balanced`.

**Phase 3, step 6a — README quickstart preference:**

Ask the user via `AskUserQuestion`:

> "Do you want doc-wiki to maintain a quickstart block in your README.md? It'll be auto-generated from `wiki/getting-started.md` on every `/doc-wiki:atlas` run, with hand-edits salvaged via LLM merge. You can change this later in `wiki.config.yaml`."

| Choice | Effect on `wiki.config.yaml` |
|---|---|
| `Yes — generous (~30 lines)` | `ecosystem.readme.{enabled: true, quickstart_depth: generous, insert_markers_on_init: true}` |
| `Yes — standard (~15 lines)` | `ecosystem.readme.{enabled: true, quickstart_depth: standard, insert_markers_on_init: true}` |
| `Yes — minimal (~5 lines)` | `ecosystem.readme.{enabled: true, quickstart_depth: minimal, insert_markers_on_init: true}` |
| `No, skip` | `ecosystem.readme.enabled: false` |

If the user picked any "Yes", dispatch `Agent(wiki-readme-agent)` with `{action: "init", project_root, wiki_root, quickstart_depth}` to insert markers into `README.md` if it exists and has none.

**Phase 3, step 6 — Install hooks + scaffold:**

1. Offer to install PreToolUse always-on hooks for the detected platform

**Phase 3, step 6b — Optional multimodal deps (Q&A):**

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

2. Generate/update `wiki.config.yaml` with all detected settings (including the `ecosystem.multimodal.enabled` choice from Phase 3, step 6b):
   ```bash
   node {skill_path}/scripts/parse_config.js --config <wiki-root>/wiki.config.yaml
   ```
3. If wiki scaffold does not exist, run `/doc-wiki:init` automatically:
   ```bash
   node {skill_path}/scripts/init_wiki.js --path <wiki-root> --domain "<detected-domain>" --name "<project-name>"
   ```

**Output of Phase 3:** A fully configured `wiki.config.yaml` with language, framework, ORM profile, database, external sources, autonomy mode, and multimodal preference. Wiki scaffold created if it did not already exist.

**Phase 4 — Atlas decision.**
- If `--no-atlas`: stop.
- If `--atlas`: dispatch `/doc-wiki:atlas` with the default facet set.
- Otherwise: `AskUserQuestion` "Generate full documentation now with /doc-wiki:atlas? (Recommended for first-run.)"
  - Yes → dispatch `/doc-wiki:atlas`.
  - No → stop, print "Run /doc-wiki:atlas later when ready."

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

   **Resolve the cross-service flag once, here, as the single source of truth.** Inspect `$ARGUMENTS` for `--no-cross-service` or `--cross-service` and capture **`<cross-service-flag>`** = exactly that token if present (at most one — `--no-cross-service` wins if both somehow appear), or the empty string if neither was passed. Forward this **same `<cross-service-flag>`** verbatim to every phase that resolves cross-service: Phase 1b (inventory `generate`), Phase 4 (`estimate-cost`), and Phase 7 (the cross-service render decision). Do **not** re-derive the decision per phase — the deterministic `resolveCrossService` resolver inside both CLIs applies the identical precedence (`--no-cross-service` > `--cross-service` > `ecosystem.cross_service.enabled` > AUTO ≥2 services), so passing the same flag everywhere guarantees Phase 1b's `services[]`, the Phase 4 cost estimate, and the Phase 7 pages can never disagree.

1b. **Inventory the repo** — call `node agents/lib/atlas_inventory.js generate --wiki-root <root> --repo-root <repo-root> --run-id <id> <cross-service-flag>` once, before topic discovery. Append the **`<cross-service-flag>`** resolved in Phase 1 (`--no-cross-service`, `--cross-service`, or nothing) so the inventory's `services[]` reflects the user's opt-out/opt-in — without this, `--no-cross-service` would be silently ignored at inventory time and Phase 7 would still emit cross-service pages. The manifest at `wiki/outputs/atlas/<run-id>/code-inventory.json` carries four buckets: `project_metadata` (name / version / language / runtime from `package.json`, `pyproject.toml`, `go.mod`, `Cargo.toml`); `orm_entities` (via the `wiki_orm` library); `rest_endpoints` (eighteen shipped profiles spanning Python / TypeScript / Java / Ruby / Go / PHP / C# / Rust / Elixir / Swift — see `agents/lib/rest_profiles/` — all run by default when REST detection is enabled); `code_clients` (`gather()` and `fetchWithCaps()` callsites). REST detection is opt-in via `ecosystem.rest.enabled: true` in `wiki.config.yaml` (default `false`); the CLI reads the flag automatically. Pass `--enable-rest` to force-enable regardless of config; restrict to a subset with `--rest-profiles <csv>` (e.g. `--rest-profiles express,fastapi`). **Custom profiles** authored inline in `wiki.config.yaml` under `ecosystem.rest.custom_profiles` are automatically loaded — same shape as the shipped YAMLs; custom names override shipped on collision so users can teach atlas about in-house frameworks without modifying doc-wiki. Endpoints from overlapping profiles are deduplicated by `(file, line, method, path)`. Consumers in this PR: Phase 8 gap-report (REST endpoints + clients without documentation). Reserved for follow-ups: Phase 4 cost-estimate, Phase 6 source heuristics, the `assembleX` helpers in `agents/lib/atlas_synthesize.ts`. Missing-manifest is non-fatal — every consumer falls back to its pre-inventory behavior.

   **Cross-service discovery** runs **automatically when the repo has ≥2 services** — no flag needed. Suppress it with `--no-cross-service`; force it with `--cross-service` or `ecosystem.cross_service.enabled: true` in `wiki.config.yaml`. Resolution precedence: `--no-cross-service` (hard off) > `--cross-service` (hard on) > `ecosystem.cross_service.enabled` (`true`/`false`) > AUTO (on iff ≥2 real services). On a monolith (0/1 service) AUTO stays off and no cross-service pages are emitted. When enabled: after the standard four-bucket inventory, atlas additionally discovers every service, library, and frontend under the repo root — git submodules and manifest directories are enumerated automatically. This is the primary use case for monorepos whose submodules or top-level subdirectories are independent services: point `--repo-root` at the repository root and atlas maps the whole architecture in one pass. Each discovered unit is analysed with the client and queue profile families (`agents/lib/client_profiles/`, `agents/lib/queue_profiles/`) and its findings are appended to `code-inventory.json` as a `services[]` array. Each entry carries: `http_clients` (outbound HTTP/RPC callsites); `queue_endpoints` (producers and consumers); `external_sources` (datasource connections, cloud-SDK calls, `narai-gather()` callsites); `library_deps` (shared-library imports); `auth_issuer` (detected identity-provider or auth-middleware). Because the cross-service call graph requires endpoint data, enabling `cross_service` implies `rest.enabled: true` for that run. Custom client profiles (`ecosystem.clients.custom_profiles`) and custom queue profiles (`ecosystem.queues.custom_profiles`) — same inline shape as `ecosystem.rest.custom_profiles` — are loaded automatically so atlas can detect in-house frameworks without modifying doc-wiki.

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
   - `node {skill_path}/scripts/atlas_orchestrator.js estimate-cost --wiki-root <root> --run-id <id> --plan '<plan-json>' <cross-service-flag>`. Pass `--run-id` so the estimate reflects cross-service AUTO: when the Phase-1b inventory has ≥2 services, the 6 cross-service global pages are included in the cost. Append the **same `<cross-service-flag>`** resolved in Phase 1 so the estimate matches what Phase 1b/7 will actually do (the resolver applies identical precedence: `--no-cross-service` > `--cross-service` > `ecosystem.cross_service.enabled` > AUTO). Omitting `--run-id` falls back to config/flags only (AUTO count 0).
   - Display the estimate; if `total_estimated_usd > --max-cost`, abort with a clear hint to re-run with a higher `--max-cost`.

5. **Validate existing** (skip when `state == "fresh"`):
   - **Structural**: for each atlas page, `node {skill_path}/scripts/atlas_validate.js structural --wiki-root <root> --page <page>`.
   - **Gitlog drift**: `node {skill_path}/scripts/atlas_gitlog.js classify --wiki-root <root> --since <since> --topics <csv>` returns `{stale_pages, uncovered_files, unrelated_files}`.
   - **Semantic**: for each atlas page (sampled if `--validate-mode shallow`, all if `full`), compute `pageHash = sha256(body)` and `sourceHash = sha256(concat(sources))`. Probe `atlas_validate.js cache-check`; on miss, read page + sources and ask yourself: "Does this page still accurately describe the source(s)? List divergences." Store the result via `atlas_validate.js cache-store`.
   - Merge findings into `wiki/outputs/atlas/<run-id>/drift-report.md`.

5b. **Archive sweep** — runs only when `ecosystem.archive.enabled: true` (default):
    `node agents/lib/atlas_archive.js sweep --wiki-root <root> --repo-root <root> --autonomy <mode> --run-id <id>`
    moves atlas pages whose local sources have all been deleted from the codebase into `wiki/_archive/`,
    stamps deprecation frontmatter, appends to `_archive_history.jsonl`, rebuilds `wiki/_archive/index.md`,
    and rewrites inbound links per `ecosystem.archive.inbound_links` mode. Under `balanced` / `conservative`
    autonomy, the script returns a `pendingConfirmation` list and the orchestrator asks
    "Archive `<page>`? [Y/n/skip-all]" per page. Partial removal (some-but-not-all sources missing) is
    surfaced in the drift report only; never auto-archived.

6. **Bootstrap / refresh** — for each plan entry not cached:
   - Save the plan snapshot first: `atlas_orchestrator.js save-plan --wiki-root <root> --run-id <id> --plan '<json>'`. The snapshot drives `--resume` so re-discovery doesn't change scope mid-run.
   - For `entry.facet == "data-model"`: dispatch `wiki-orm-agent` and write the result to `entry.output` with atlas frontmatter.
   - For other facets: dispatch `/doc-wiki:ingest <source-list> --output <entry.output> --no-crosslink --no-tag-harmonize` (defer post-op hooks to Phase 8).
   - For drift-flagged stale pages: dispatch `/doc-wiki:ingest --refresh --source <source>`.
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

   **Cross-service pages** — governed by the **same resolved decision** as Phase 1b (the `<cross-service-flag>` from Phase 1, applied via the identical precedence: `--no-cross-service` > `--cross-service` > `ecosystem.cross_service.enabled` > AUTO ≥2 services). When that decision is **off** (e.g. the user passed `--no-cross-service`, or it's a monolith), **skip this step entirely** — Phase 1b will have left `services[]` empty, so there is nothing to render anyway. When **on**, run two deterministic CLIs in sequence — these are graph renders, not LLM synthesis. As a second line of defense the renderer self-gates on the built service graph (`hasServiceTopology`), so a repo with no real topology emits no pages even if the step runs:
   1. `node agents/lib/cross_service_edges.js build --wiki-root <w> --run-id <id>` — reads `services[]` from the Phase 1b inventory and emits `outputs/atlas/<id>/service-graph.json` (nodes = services, edges = typed dependencies).
   2. `node agents/lib/cross_service_pages.js render --wiki-root <w> --run-id <id>` — consumes `service-graph.json` and writes six wiki pages:

   | Page | `atlas_facet` | Audience | Content |
   |---|---|---|---|
   | `wiki/service-map.md` | `service-map` | `contributor` | Visual topology diagram of all services and their dependency edges |
   | `wiki/service-dependencies.md` | `service-dependencies` | `integrator` | Per-service dependency tables; External Dependencies section cross-links `integrations.md` (does not duplicate it) |
   | `wiki/client-registry.md` | `client-registry` | `contributor` | All HTTP-client callsites by originating service |
   | `wiki/queue-registry.md` | `queue-registry` | `contributor` | All queue producers and consumers by service |
   | `wiki/database-traces.md` | `database-traces` | `contributor` | Datasource access paths traced back to the service that owns them |
   | `wiki/shared-libraries.md` | `shared-libraries` | `contributor` | Libraries imported by more than one service, with reverse-dependency counts |

   All six pages carry the standard atlas frontmatter (`atlas_run_id`, `atlas_facet`, `audience`). They are included in the Phase 8 `wiki/index.md` re-listing and the cross-doc-ownership scan.

8. **Finalize**:
   - Run `/doc-wiki:lint` (no `--fix`) and append findings to the drift report.
   - **Cross-doc-ownership scan**: `node {skill_path}/scripts/atlas_validate.js cross-doc --wiki-root <root>` flags pairs of architecture pages that share both ≥1 source path AND ≥1 Mermaid diagram title. Surface as drift findings — one page should own each shared concept (mirrors the "Cross-doc concerns" registry pattern in `docs/README.md`).
   - **Gap report**: `node {skill_path}/scripts/atlas_orchestrator.js gap-report --wiki-root <root> --plan '<json>' --run-id <id> --gitlog '<json>'` writes `wiki/outputs/atlas/<run-id>/gap-report.md` enumerating topics-without-pages, facets-without-coverage, source-files-with-no-page, gitlog-uncovered-files, external-services-without-documentation, and (when the Phase 1b inventory manifest is present at the canonical path) REST-endpoints-without-documentation + code-clients-without-documentation. Always emitted; non-empty sections are actionable items for a follow-up `--scope` ingest.
   - Update `wiki/index.md` (re-list all atlas pages by facet).
   - Run global crosslink + tag-harmonize over the entire wiki.
   - **Dispatch root-file agents in parallel** (after crosslink + tag-harmonize so root-file content reflects the final wiki state):
     - `Agent(wiki-claude-md-agent)` with `{action: "update", project_root: <repo-root>, wiki_root: <root>, targets: [<all present AI-tool root files>]}` — gated on `ecosystem.claude_md.enabled` (default `true`). Targets: `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `.cursor/rules/doc-wiki.mdc`, `.aider/conventions.md` (only those that exist on disk). The agent splices the `claude_md_gen.js --block` body between each target's `wiki-managed: reference` markers, **skipping targets that already carry the body pair** (`<!-- wiki-managed: start -->`) — those already contain the imperative core, and splicing both pairs would duplicate it; skipped targets report `skipped (body-managed)` in the drift report.
     - `Agent(wiki-readme-agent)` with `{action: "sync", project_root: <repo-root>, wiki_root: <root>}` — gated on `ecosystem.readme.enabled` (default `true`).
     - The two agents touch disjoint files; parallel dispatch is safe.
     - Per-agent failures are logged to the drift report and do not halt Phase 8 (matches the existing per-step error-isolation policy).
     - Under `--dry-run`, both dispatches use `action: "check"` instead of `update`/`sync` — no writes happen but the drift report is still produced.
   - **Format the agent responses into the drift report.** The orchestrator takes the JSON returned by each agent dispatch and appends two sections to `outputs/atlas/<run-id>/drift-report.md`:
     - `## Root-file reference block sync (wiki-claude-md-agent)` — one row per target with status (`updated` / `skipped (body-managed)` / `error: <error_code>`).
     - `## README sync (wiki-readme-agent)` — drift summary table from `salvaged_paragraphs[]` with columns `Disposition | Paragraph | Action`, plus a one-line salvage summary (`N paragraphs kept, M reworded, K dropped`).
   - `node {skill_path}/scripts/event_logger.js log --op atlas --wiki-root <root> --details '<json>'` with fields: `atlas_run_id`, `phase_durations`, `total_cost_usd`, `pages_generated`, `pages_refreshed`, `pages_drifted`, `topics_covered`.
   - Clear the checkpoint via `clearCheckpoint(wikiRoot, "atlas")`.
   - Write `wiki/outputs/atlas/<run-id>/cost-report.md` with the planned breakdown from `estimate-cost` plus actual costs from this run's events.

**Atlas frontmatter conventions** — every atlas-generated page carries two extra fields beyond the standard set:

- `atlas_facet`: one of `architecture`, `data-model`, `environments`, `api`, `operations`, `overview`, `integrations`, `deploy`.
- `atlas_run_id`: timestamp of the generating atlas run (`YYYY-MM-DDTHH-MM-SS`).

These let atlas recognize its own pages on re-runs and skip semantic-cache invalidation when nothing changed.

Pages that have been archived gain four additional fields:

- `status: deprecated`
- `archived_at: <YYYY-MM-DD>`
- `archive_reason: <free-text reason>`
- `archived_from: <wiki-relative original path>`

These are stamped by the Phase 5b sweep and stripped by `/doc-wiki:unarchive`.

**Page template** — every atlas page targets 300–800 lines, splits to sibling subpages beyond, starts with a TL;DR, and ends with cross-links **written at page-creation time** (the post-op crosslink hook later refines, but never bootstraps, the section). The body section is **facet-conditional** so each audience gets the structure it needs.

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
<3–5 hand-picked `[Title](relative/path.md)` bullets, written when the page is written.
 Pick from: same-topic siblings (other facets of this topic), same-facet peers
 (this facet on other topics), and the most relevant audience-flavor globals
 (overview, integrations, deploy, commands, configuration, getting-started,
 troubleshooting). Do NOT emit a `<!-- crosslink hook will populate -->` (or
 similar deferred-fill) placeholder — pages must ship with this section
 populated. The post-op crosslink hook refines/extends; it does not bootstrap.>
```

**Body sections by facet** (the LLM should follow these structural conventions; they mirror the patterns documented in `docs/internals/architecture.md`, `docs/commands.md`, `docs/troubleshooting.md`):

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

| Autonomy | Stale (gitlog) | Structural | Semantic | Uncovered files | Orphan sources (5b) | Partial (5b) |
|---|---|---|---|---|---|---|
| `conservative` | Ask before refresh | Report only | Report only | Ask before ingest | Report only | Report only |
| `balanced` (default) | Auto-refresh | Auto-fix safe; report structural | Report; ask | Auto-ingest if matches current topic; else report | Ask per page | Report only |
| `autonomous` / `auto` | Auto-refresh | Auto-fix all | Auto-fix; ask on conflicts | Auto-ingest | Auto-archive | Report only |

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

#### Re-fetching with `--refresh`

When invoked with `--refresh`, `/doc-wiki:ingest` re-fetches a previously-ingested source instead of registering a new one. The set of previously-ingested sources is reconstructed from the `op: ingest` entries in `<wikiRoot>/log/events.jsonl` (filter via `event_logger.js`'s `--op ingest` mode). Two scope flags:

- `--source <s>`: re-fetch a single previously-ingested source whose URL, label, or path matches `<s>`.
- `--all`: re-fetch every previously-ingested source.

The flow: enumerate prior ingest events, re-run `gather()` against each source, diff the new payload against `<wikiRoot>/raw/<source>/`, re-compile only changed pages, update indexes, log a `refresh` event per source. Supports checkpoint resume — interrupted batches can be re-run; only un-checked entries are retried. Use `scripts/checkpoint.ts` with `opName "refresh"` the same way `/doc-wiki:ingest` uses it for folder sources — each source URL becomes a unit, and an interrupted refresh picks up at the next unfinished source on re-invocation.

`ingest <src>` (new source) and `ingest --refresh` (re-fetch) are mutually exclusive at the wrapper layer.

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
8. Offer to promote to wiki page via `/doc-wiki:query --promote` (see Post-answer promote prompt below)

Log token efficiency: `node {skill_path}/scripts/event_logger.js --op query --wiki-root <wiki-root> --details '{"tokens_in": N, "tokens_out": M, "reduction_ratio": R}'`

#### Path mode

```bash
node {skill_path}/scripts/graph_ops.js path --from "<concept-a>" --to "<concept-b>" --edges <wiki-root>/graph/edges.jsonl
```

Returns the typed-edge chain connecting two concepts. Supports `--max-hops`, `--via`, `--all-paths`. Read-only — no autonomy gate, no archive, no synthesis.

#### Post-answer promote prompt (synthesis mode)

After rendering a synthesis-mode answer + citations, run `AskUserQuestion` "Save this answer as a permanent wiki page?". Gated by autonomy mode the same way other interactive prompts are (suppressed in non-interactive autonomy levels). Path mode skips this prompt. On "yes", run the single-promote flow below against the freshly-written archive in `outputs/queries/`.

#### `--promote <file|last|N>` — explicit promote of an archived answer

Resolve the target argument with the first matching rule:

| Input form | Resolution |
|---|---|
| `last`, `latest`, `last query`, `latest query` | Most-recent `outputs/queries/*.md` by mtime |
| Bare positive integer `N` | Nth most-recent (1-indexed; `1` == latest) |
| Existing path (relative or absolute) | Use as-is |
| Single token, no path | Match by filename substring; if 0 or >1 match, list candidates and ask |
| Empty | List recent + prompt the user to pick |

Pick by mtime via `ls -1t <wiki-root>/outputs/queries/*.md`. Always exclude `outputs/queries/.promoted/` and `outputs/queries/.deleted/` — these subdirs hold archives that were already triaged.

The slash form `/doc-wiki:query --promote last query` is the canonical, deterministic phrasing. The bare form (typed without the slash, e.g. `promote last query`) is best-effort — the skill description's keyword set covers it, but ambiguous contexts may need a clarifying turn.

Single-promote flow:

1. Resolve the target.
2. Read the query archive.
3. Compile a wiki page — frontmatter, claims, links, summary; convert inline citations to relative markdown links.
4. Write to `wiki/<topic>/<slug>.md` (`--topic` overrides; otherwise infer from content).
5. Update `wiki/index.md` and `wiki/summaries.md`.
6. Move the source archive to `outputs/queries/.promoted/<filename>` so it is not re-suggested by `--review` or by `/doc-wiki:lint` query-absorption.
7. Run post-op hooks (crosslink + tag-harmonize).

#### `--review [--since <dur>] [--limit <N>] [--topic <dir>]` — bulk archive triage

```
/doc-wiki:query --review [--since <duration>] [--limit <N>] [--topic <directory>]
```

Bulk archive triage with per-item approval. `--since` filters by mtime (e.g. `7d`, `24h`); `--limit` caps candidates; `--topic` overrides topic for every promotion in this batch.

For each candidate (oldest first, skipping `.promoted/` and `.deleted/`):

1. Read title + first ~30 lines of the archive.
2. Run the same coverage check `/doc-wiki:lint` query-absorption uses: is this insight already on a wiki page?
3. If covered → skip silently (or in `conservative`, ask "Already covered by `<page>`. Promote anyway?").
4. If novel → present `[P]romote / [S]kip / [D]elete archive / [A]bort batch`.
5. On `P` → run the single-promote flow (steps 1-7 above) for this archive.
6. On `D` → move to `outputs/queries/.deleted/<filename>`. Never `rm` — preserve for audit.
7. On `A` → stop, summarize what was done so far.

End the run with one line: `<X> promoted, <Y> skipped, <Z> deleted, <W> already-covered`.

**Autonomy interaction:**

| Mode | Per-archive prompt | "Already covered" |
|---|---|---|
| `conservative` | Always ask P/S/D/A | Ask before promoting anyway |
| `balanced` (default) | Always ask P/S/D/A | Auto-skip |
| `autonomous` | Auto-promote novel; ask only on conflicts | Auto-skip |
| `auto` | Auto-promote novel; auto-skip everything | Auto-skip |

`balanced` is the "individual user approval" workflow.

**Periodic execution:** For interactive `balanced`/`conservative` use, schedule a *reminder* with the `/schedule` skill rather than an unattended run:

```
/schedule "Run /doc-wiki:query --review --since 7d" "every Monday at 9am"
```

For unattended pipelines, set autonomy to `auto` and schedule the command directly — the orchestrator will batch-promote novel archives without prompting.

See also: `/doc-wiki:lint` query-absorption (below) — same coverage rule, different entry point.

### /doc-wiki:lint — Health check + auto-heal

Run structural checks via script, then LLM-driven checks yourself:

```bash
node {skill_path}/scripts/lint_checks.js --wiki-root <wiki-root>
```

The script reports: broken links, missing frontmatter (including page-type enum), orphan pages, isolated nodes, code-ref drift, provenance completeness, stale content (>90 days via `--stale-days N`). Then YOU do: factual contradictions, terminology consistency, missing coverage, query absorption.

**Query absorption:** after the structural pass, scan `outputs/queries/*.md` (skipping `outputs/queries/.promoted/` and `outputs/queries/.deleted/`) for archived answers that contain insights not yet captured in any wiki page. For each novel insight, propose (per autonomy mode) either (a) a `/doc-wiki:edit` on the most relevant existing page, or (b) a `/doc-wiki:query --promote` of the archived query. For a focused archive-only triage flow (without the rest of lint), use `/doc-wiki:query --review` — same coverage rule, different entry point.

**Anti-repetition memory:** run `node {skill_path}/scripts/summaries_rebuild.js --wiki-root <root>` — the rebuilder pulls deprecated claims' `failure_reason` fields via `banlist.buildBanlistSection()` and splices them into `wiki/summaries.md` under `## Anti-repetition Memory`. This prevents future ingests from re-exploring abandoned directions. (For the section in isolation, `banlist.js build --wiki-root <root>` still prints it to stdout.)

Read `references/quality.md` for scoring rules and `references/autonomy.md` for how to decide what to auto-fix vs ask the user.

### /doc-wiki:edit — Targeted page changes

1. User identifies the page and what to change
2. Read the page
3. Show diff (current vs proposed)
4. Apply if autonomy mode permits
5. Log + run post-op hooks

### /doc-wiki:unarchive — Restore an archived page

Restore a previously-archived wiki page from `wiki/_archive/` back to the active wiki.

```
/doc-wiki:unarchive <path-or-slug> [--target <wiki-relative-path>] [--yes]
```

**Arguments:**

- `<path-or-slug>` — either a full path under `wiki/_archive/` (e.g. `wiki/_archive/auth/overview.md`) or a slug substring matched case-insensitively against the `archived_from` frontmatter field. If the substring matches more than one archived page, the orchestrator lists the candidates and asks the user to disambiguate.
- `--target <wiki-relative-path>` — destination path relative to the wiki root (e.g. `wiki/auth/overview.md`). Defaults to the value of the `archived_from` frontmatter field. If the default target already exists on disk, the orchestrator stops and reports a conflict.
- `--yes` — skip the confirmation prompt regardless of autonomy mode.

**Flow:**

1. **Resolve** — locate the archive entry by path or slug. If multiple matches, list and ask.
2. **Target check** — determine destination from `--target` or `archived_from`. If the destination already exists, abort with a conflict message.
3. **Move** — move the file from `wiki/_archive/<path>` to the resolved destination.
4. **Strip frontmatter** — remove `status: deprecated`, `archived_at`, `archive_reason`, and `archived_from` fields from the page's frontmatter.
5. **Append history** — append an `unarchive` event to `_archive_history.jsonl`. The event shape is:
   ```jsonc
   {
     "ts": "2026-05-24T16:10:00Z",     // ISO8601 timestamp
     "op": "unarchive",                 // discriminator (vs "archive")
     "from": "wiki/_archive/billing/architecture.md",  // the archived path
     "to": "wiki/billing/architecture.md"              // restored target
   }
   ```
6. **Rebuild index** — regenerate `wiki/_archive/index.md` to reflect the removed entry.
7. **Inverse link rewrite** — run `node agents/lib/atlas_archive.js rewrite-inbound-links-unarchive --wiki-root <root> --event-file <path-to-event-json>` to restore or update links in active wiki pages that were rewritten or dropped during the original archive sweep.
8. **Post-op hooks** — run the standard crosslink and tag-harmonize passes (unless `--no-crosslink` / `--no-tag-harmonize`).

**Autonomy gates:**

| Autonomy | Behavior |
|---|---|
| `conservative` / `balanced` | Ask one confirmation before proceeding: "Restore `<page>` to `<target>`? [Y/n]" |
| `autonomous` / `auto` | Proceed without prompt |
| `--yes` | Overrides prompt at any autonomy level |

### /doc-wiki:stats — Token efficiency and cost metrics

```bash
node {skill_path}/scripts/event_logger.js stats --wiki-root <wiki-root> --since 7d
```

Shows running averages, p50/p95 reduction ratios, total spend, per-agent cost breakdown. Per-agent cost sums top-level `agent` fields as well as every `agent_calls[]` sub-entry on every event, so parent-op events that dispatched sub-agents are fully accounted for.

## Root-file Reference Block

Every AI-tool entry-point file at the repo root carries the wiki-managed **imperative** block exactly once: a behavioral directive to consult the wiki before changing code, plus an intent→page routing table. Files doc-wiki generated from scratch carry it in the body pair (`wiki-managed: start/end`); every other root file gets it spliced into the trailing reference block. Passive pointer listings are empirically ignored by coding agents (vitest benchmark); the imperative directive + routing table is what changes behavior. Affected files:

- `CLAUDE.md` (Claude Code)
- `AGENTS.md` (Codex / OpenAI agents)
- `GEMINI.md` (Gemini)
- `.cursor/rules/doc-wiki.mdc` (Cursor)
- `.aider/conventions.md` (Aider)

The block is owned by `wiki-claude-md-agent` (which generalizes to all five surfaces despite its Claude-Code-flavored name). The body is generated **deterministically** by `claude_md_gen.js --block`; the agent only splices it between the existing markers. Content outside the markers is preserved verbatim.

**Body-pair skip rule:** a root file that already carries the body pair (`<!-- wiki-managed: start/end -->`, e.g. a doc-wiki-generated root `CLAUDE.md`) already contains the same imperative core — the reference block is **skipped** for it (never duplicated), and the target reports `skipped (body-managed)`. The guard is enforced in code by `claude_md_gen.js --block --update <target>`.

### Canonical structure

```bash
node agents/wiki-claude-md-agent/scripts/claude_md_gen.js --project-root <repo-root> --wiki-root <root> --block --update <target>
```

(`--block` without `--update` prints the body to stdout, no writes.)

```markdown
<!-- wiki-managed: reference start -->
## Wiki

Before changing code in this repository, consult the wiki for the relevant subsystem. Treat the wiki as the source of truth for architecture, data flow, and conventions; verify your assumptions against it before implementing. If the wiki does not cover something, say so rather than guessing.

| If you need to… | Read |
|---|---|
| understand how the system fits together | [overview.md](docs/<wiki-folder>/wiki/overview.md) |
| understand the auth subsystem architecture | [architecture.md](docs/<wiki-folder>/wiki/auth/architecture.md) |

[Full wiki index](docs/<wiki-folder>/wiki/index.md)

AI-tool configuration registry: [docs/<wiki-folder>/ai-dev/](docs/<wiki-folder>/ai-dev/)
<!-- wiki-managed: reference end -->
```

The marker vocabulary is unchanged (`wiki-managed: reference start/end`), so files written under the old passive structure update in place. Links are relative to the repo root; `--block` accepts both wiki layouts via `resolveScaffoldRoot`. When no faceted pages exist, the routing table degrades to a browse pointer + a nudge to run `/doc-wiki:atlas`. The trailing registry line is emitted only when `docs/<wiki-folder>/ai-dev/` exists — it is the single pointer that keeps the per-tool config files discoverable from the root files (they live outside `wiki/`, so the routing table and index cannot surface them).

`<wiki-folder>` is the leaf-folder name from the wiki path (e.g., for `/doc-wiki:init --path docs/my-app-wiki/`, `<wiki-folder>` = `my-app-wiki`).

### Per-tool config files (`docs/<wiki-folder>/ai-dev/<tool>-config.md`)

One markdown file per AI tool (only for tools whose root file is present in the repo), all generated and maintained by `wiki-claude-md-agent`. They are reachable from the root files solely through the block's trailing `AI-tool configuration registry` pointer line. Each file is a structured inventory of how that tool sees the project:

| Section | Content |
|---|---|
| Skills | name + description + invocation mode for every installed skill |
| Agents | `subagent_type` + purpose for every agent the tool can dispatch |
| Hooks | `PreToolUse` / `PostToolUse` / `SessionStart` registrations + their commands |
| MCP servers | name + capabilities for every MCP server the tool loads |
| Slash commands | `/<name>` + summary for every command file the tool exposes |

Files are read by the AI tool only when the user explicitly asks "what skills/agents/hooks are configured?" or equivalent — they are not loaded into the default context window.

### Generation triggers

The reference block is regenerated on:

1. `/doc-wiki:init` — initial block written (directive + no-routing-rows pointer; no atlas pages yet).
2. `/doc-wiki:init` Phase 3 (Onboarding Q&A) — per-tool config files are first created here.
3. `/doc-wiki:atlas` Phase 8 (finalize) — refreshed alongside the rest of the wiki.
4. Any direct `Agent(wiki-claude-md-agent)` invocation.

### Determinism rule

The block body is the verbatim output of `claude_md_gen.js --block` — never hand-edit between the markers. Its length tracks the routing table (one row per actionable wiki page); anything that wants to be a paragraph belongs as a wiki page, not in the block.

## Post-Operation Hooks

After any write operation (`/doc-wiki:ingest`, `/doc-wiki:edit`, `/doc-wiki:query --promote`, `/doc-wiki:unarchive`), run BOTH hooks if the wiki has >= 3 pages:

**Crosslink pass:** Read ALL wiki pages. Find meaningful relationships. Add 2-5 inline links per page (in the body, not just the trailing list). **Refine** the `## Related Pages` section on each page — pages must already have a populated section from when they were written, so the hook adjusts existing entries and adds newly-discovered ones, but never replaces a placeholder. If a page is found with a `<!-- crosslink hook will populate -->` marker (or any other deferred-fill placeholder, or an empty `## Related Pages` body), treat it as a bug in the page-creation step and call it out in the hook's run summary so the upstream writer (`/doc-wiki:atlas`, `/doc-wiki:ingest`, `/doc-wiki:query --promote`) gets corrected — do not silently fill it in. When generating fresh `## Related Pages` links, never create new inbound links to archived pages. Treat archived pages as link targets ONLY when a pre-existing link already points there (handled by `atlas_archive.rewriteInboundLinks`).

**Tag-harmonize pass:** Build tag vocabulary from all frontmatter. Scan each page's body. Add existing tags where missing. Only suggest new tags for concepts on 2+ pages. Enforce content-only tag philosophy (no structural/temporal/metadata tags). Target: 4-8 concept tags per page. Skip any page under `wiki/_archive/` — archived pages have frozen frontmatter and do not participate in tag vocabulary discovery.

**Archive-link rewrite (pre-crosslink):** When the operation includes archive sweep events, run `atlas_archive.js rewrite-inbound-links --wiki-root <root> --events-file <path-to-events-json> --mode <rewrite|drop|leave>` BEFORE the standard crosslink pass. For unarchive operations, run `atlas_archive.js rewrite-inbound-links-unarchive --wiki-root <root> --event-file <path-to-event-json>` instead. Both produce idempotent text edits and are safe to re-run.

Skip hooks with `--no-crosslink` or `--no-tag-harmonize` flags.

## Quality scoring

After lint, compute quality scores:
```bash
node {skill_path}/scripts/quality_score.js --wiki-root <wiki-root>
```

Scores each page 0.0-1.0 based on word count, frontmatter completeness, link density, tags, source citations, god-node degree bonus (+0.1), isolation penalty (-0.2).

## Sub-agent dispatch

`/doc-wiki:ingest` step 7 dispatches via `narai-primitives`'s `gather()` — one library call plans and spawns the bundled connector CLIs in parallel. There are no per-service wrapper scripts or subagents in doc-wiki; the legacy `wiki-<svc>-agent` folders were removed because they only duplicated the hub's CLI resolution and the `mermaid_augment.ts` decoration. Add a new builtin connector by adding an entry to `BUILTIN_PATTERNS` in `source_registry.ts`. Add an out-of-tree connector via `wiki.config.yaml`'s `ecosystem.agents.custom` block.

The wiki-specific derivation agents (dispatched directly via the Agent tool, not through `gather()`) are:

| Agent | Purpose |
|---|---|
| `wiki-claude-md-agent` | Regenerate the imperative `<!-- wiki-managed: reference start/end -->` block (body from `claude_md_gen.js --block`) in AI-tool root files (`CLAUDE.md`, `AGENTS.md`, etc.), skipping body-managed targets, and refresh per-tool config files under `docs/<wiki-folder>/ai-dev/`; dispatched by atlas Phase 8. |
| `wiki-readme-agent` | Sync repo-root `README.md` quickstart marker block against `wiki/getting-started.md` with LLM salvage; dispatched by atlas Phase 8. |
| `wiki-mermaid-agent` | Generate Mermaid architecture diagrams for wiki pages. |
| `wiki-orm-agent` | ORM model detection and entity-to-table mapping; dispatched by `/doc-wiki:init` (Phase 3) and atlas Phase 6. |

## Reference files

Read these as needed — don't load them all upfront:

- `references/operations.md` — Detailed specs for each operation, onboarding flow, edge cases
- `references/compilation.md` — Compilation rules: frontmatter schema, link enrichment, cross-referencing, code locality, claims extraction, "How to Go Deeper" generation
- `references/quality.md` — Quality scoring rules, tag philosophy, content-only tags, Mermaid lint
- `references/autonomy.md` — 4 autonomy modes (conservative/balanced/autonomous/auto), per-category overrides, decision flow
- `references/code-locality.md` — When to reference code vs copy it, content_hash drift detection
