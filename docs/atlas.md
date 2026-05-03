# `/doc-wiki:atlas`

`/doc-wiki:atlas` is the meta-orchestrator that documents an entire codebase in one phased pass. It does not replace [`/doc-wiki:ingest`](commands.md#doc-wikiingest--fetch-extract-compile) — it batches it across discovered topics and facets, then synthesizes global aggregation pages on top.

This document is the operator-facing walkthrough of the eight phases. The architectural overview (with a Mermaid pipeline diagram) lives in [`architecture.md` § Diagram 4](architecture.md#diagram-4-doc-wikiatlas-pipeline); the orchestrator's full prose prompt is the canonical reference at [`SKILL.md` § /doc-wiki:atlas](../skills/doc-wiki/SKILL.md). Use this doc when you want to know what each phase does, what it writes to disk, and how to reason about cost and resumption.

## Table of contents

- [What it does](#what-it-does)
- [Prerequisites](#prerequisites)
- [Quickstart](#quickstart)
- [The eight phases](#the-eight-phases)
  - [Phase 1 — Detect state](#phase-1--detect-state)
  - [Phase 1b — Inventory the repo](#phase-1b--inventory-the-repo)
  - [Phase 2 — Discover topics](#phase-2--discover-topics)
  - [Phase 3 — Confirm topics](#phase-3--confirm-topics)
  - [Phase 4 — Estimate cost](#phase-4--estimate-cost)
  - [Phase 5 — Validate existing](#phase-5--validate-existing)
  - [Phase 6 — Bootstrap / refresh](#phase-6--bootstrap--refresh)
  - [Phase 7 — Synthesize globals](#phase-7--synthesize-globals)
  - [Phase 8 — Finalize](#phase-8--finalize)
- [Configuration](#configuration)
- [Output structure](#output-structure)
- [Resuming a partial run](#resuming-a-partial-run)
- [Cost and cap](#cost-and-cap)
- [Related commands](#related-commands)

## What it does

A single `/doc-wiki:atlas` invocation runs eight serial phases. The first four prepare a plan; the next three execute it; the last finalizes outputs and emits drift / cost reports.

| # | Phase | Driver | Output |
|---|---|---|---|
| 1 | Detect state | `atlas_orchestrator.js detect-state` | wiki state (`fresh` / `existing` / `hybrid`) |
| 1b | Inventory the repo | `atlas_inventory.js generate` | `wiki/outputs/atlas/<run-id>/code-inventory.json` |
| 2 | Discover topics | LLM (orchestrator skill) | merged topic list |
| 3 | Confirm topics | LLM, autonomy-gated | committed topic list |
| 4 | Estimate cost | `atlas_orchestrator.js estimate-cost` + `compute-sources` | `Plan` JSON + `CostEstimate` |
| 5 | Validate existing | LLM + `atlas_validate.js` + `atlas_gitlog.js` | drift report |
| 6 | Bootstrap / refresh | per-topic-facet `/doc-wiki:ingest` and `/doc-wiki:refresh` | per-topic atlas pages |
| 7 | Synthesize globals | LLM over `atlas_synthesize.js` bundles | `wiki/overview.md`, `integrations.md`, `deploy.md`, etc. |
| 8 | Finalize | `lint_checks.js` + index update + crosslink + `op: atlas` event | gap report, drift report, cost report |

Per-topic ingests in Phase 6 may run in parallel within the phase boundary (default concurrency 3). Everything else is serial.

## Prerequisites

Before `/doc-wiki:atlas` can run productively:

- The wiki has been initialized — [`/doc-wiki:init`](commands.md#doc-wikiinit--bootstrap-a-wiki) has populated `wiki.config.yaml`.
- Connectors are configured if you intend to ingest from external services — [`/doc-wiki:onboard`](commands.md#doc-wikionboard--interactive-onboarding) has written `~/.connectors/config.yaml` (see [`configuration.md`](configuration.md) and [`connectors.md`](connectors.md)).
- The repo is at the ref you want to document. Atlas does not reset or stash; uncommitted edits are inventoried as-is.

For real LLM-driven runs, your Anthropic credentials must be available to Claude Code. `--dry-run` skips every LLM call.

## Quickstart

The default invocation is the right one for a fresh wiki:

```bash
/doc-wiki:atlas
```

Atlas will detect that the wiki is `fresh`, walk you through topic discovery (Phase 3 prompts unless `autonomy.mode` is `auto` or you pass `--yes`), display a cost estimate, and run the full pipeline.

For an iteration on an existing wiki:

```bash
/doc-wiki:atlas --since 7d
```

This looks at gitlog churn since seven days ago to scope which topics need refreshing, then re-runs Phases 4–8 with that narrower scope. The full synopsis and flag reference is in [`commands.md` § /doc-wiki:atlas](commands.md#doc-wikiatlas--full-application-documentation).

## The eight phases

### Phase 1 — Detect state

Decides what mode atlas runs in:

- **fresh** — the wiki has fewer than three pages tagged `atlas: true` AND no prior `op: atlas` event in `log/events.jsonl`. Phase 5 is skipped; everything is bootstrapped.
- **existing** — at least three atlas pages AND a prior atlas event. Run the full pipeline including Phase 5 validation.
- **hybrid** — pages exist but no prior atlas event (manual ingests only). Phase 5 runs but skips semantic checks on pages without `atlas_run_id` frontmatter.

The `atlas_run_id` (format `YYYY-MM-DDTHH-MM-SS`) is minted at the end of Phase 1 and reused across every artifact below — inventory, plan snapshot, drift report, cost report, gap report.

Driver: [`skills/doc-wiki/scripts/atlas_orchestrator.ts`](../skills/doc-wiki/scripts/atlas_orchestrator.ts) `detect-state`.

### Phase 1b — Inventory the repo

Walks the repo once and emits a four-bucket manifest at `wiki/outputs/atlas/<run-id>/code-inventory.json`:

- `project_metadata` — name / version / language / runtime parsed from `package.json`, `pyproject.toml`, `go.mod`, `Cargo.toml`.
- `orm_entities` — every entity discovered by the [`wiki_orm` library](architecture.md#3c-shared-libraries) (seven shipped profiles: SQLAlchemy, Django, JPA, Prisma, TypeORM, ActiveRecord, Entity Framework).
- `rest_endpoints` — HTTP routes from eighteen shipped REST profiles spanning Python / TypeScript / Java / Ruby / Go / PHP / C# / Rust / Elixir / Swift. Opt-in via `ecosystem.rest.enabled: true` in `wiki.config.yaml` (see [`configuration.md`](configuration.md#ecosystem-section)).
- `code_clients` — `gather()` and `fetchWithCaps()` callsites — anywhere doc-wiki's connector primitives are invoked.

Custom REST profiles authored inline under `ecosystem.rest.custom_profiles` are loaded automatically — see the [REST profile authoring guide](rest-profiles.md). Endpoints from overlapping profiles are deduplicated by `(file, line, method, path)`.

The manifest feeds:

- **Phase 4** cost estimate, where `data-model` and `api` facet sources come from `compute-sources` (manifest lookups) instead of glob heuristics. Other facets stay on heuristics; the manifest doesn't model them.
- **Phase 8** gap report, which lists endpoints and code-client callsites without documentation.
- **`/doc-wiki:lint`**'s `references_inventory` check, which flags page `references:` entries that point to files the manifest never saw.

Driver: [`agents/lib/atlas_inventory.ts`](../agents/lib/atlas_inventory.ts) `generate`.

A missing manifest is non-fatal — every consumer falls back to its pre-inventory behavior, so an interrupted Phase 1b just means Phase 4/6 use heuristic source lists for that run.

### Phase 2 — Discover topics

The orchestrator skill unions five signals into one deduplicated list:

- **Code dirs** — top-level subdirectories of `src/`, `app/`, `services/`, etc., minus vendored / `node_modules` / `.git`.
- **ORM domains** — entities from the inventory, grouped into topic candidates by name (e.g. `User` → `auth`, `Invoice` → `billing`).
- **Existing wiki dirs** — `wiki/<topic>/` subdirectories already on disk.
- **Gitlog churn** — `atlas_gitlog.js classify` flags paths whose changes haven't propagated to documentation.
- **Tooling / CLI repos** — when `domain: tooling` is set in `wiki.config.yaml` AND the repo has a top-level `commands/` directory, every `commands/*.md` slug becomes a topic candidate so each slash command can have its own architecture page.

Each candidate is canonicalized: lowercase-kebab-case, with `-service`, `-svc`, `-module` suffixes stripped. Deduplication is on the canonical name.

### Phase 3 — Confirm topics

The merged list is presented with provenance — which signals contributed each topic. Behavior depends on autonomy:

- `balanced` and stricter — prompt `Generate atlas pages for these topics? [Y/n/edit]`.
- `auto` / `autonomous` — proceed silently.
- `--yes` flag — skip the prompt regardless of mode.

The confirmed list becomes the canonical topic set for the rest of the run.

### Phase 4 — Estimate cost

Two sub-steps:

1. **Build the plan.** The orchestrator constructs a `Plan` JSON: `{ topics, facets, entries: [{topic, facet, sources, output}], created_at }`. For the manifest-backed facets (`data-model` and `api`), `entry.sources` is populated by `atlas_orchestrator.js compute-sources --wiki-root <p> --run-id <id> --topics <csv>`, which returns a `topic → facet → file[]` map drawn from the Phase 1b inventory. For `architecture`, `environments`, and `operations`, sources come from glob heuristics (`src/<topic>/`, `.env*`/`config/<topic>*`, runbook directories) — the manifest doesn't model them yet.
2. **Estimate.** `atlas_orchestrator.js estimate-cost --wiki-root <p> --plan '<json>'` rolls a per-ingest average over recent `op: ingest` events in `log/events.jsonl` and multiplies it by the entry count, plus a fixed allowance for Phase 7 globals.

If `total_estimated_usd > --max-cost`, the run aborts with a hint to re-invoke at a higher cap. Default `--max-cost` is conservative (see [`commands.md`](commands.md#doc-wikiatlas--full-application-documentation)).

The plan is also persisted at `wiki/outputs/atlas/<run-id>/plan.json` so `--resume` can pick up where Phase 6 left off without re-discovering topics.

### Phase 5 — Validate existing

Skipped when state is `fresh`. Otherwise:

- **Structural** — for each existing atlas page, `atlas_validate.js structural` runs the lint subset relevant to atlas frontmatter (atlas tag, run id, facet, sources). Failures surface in the drift report.
- **Gitlog drift** — `atlas_gitlog.js classify` returns `{stale_pages, uncovered_files, unrelated_files}` since `--since`. Stale = page references a file that has changed; uncovered = file is under a current-run topic but no atlas page exists yet; unrelated = neither.
- **Semantic check** — when state is `existing` or `hybrid`, the orchestrator compares each page's content to its current sources. The `(page-hash, source-hash)` cache in `atlas_validate.js` skips pages whose inputs haven't moved.

The drift report is written at `wiki/outputs/atlas/<run-id>/drift-report.md`.

### Phase 6 — Bootstrap / refresh

For each `(topic, facet)` entry in the plan:

- `state == fresh` or no existing page for the entry — dispatch `/doc-wiki:ingest` against the entry's sources, with `--output wiki/<topic>/<facet>.md` so the destination is pinned.
- Existing page that is stale or under-covered — dispatch `/doc-wiki:refresh --source <ref>`.

Per-entry ingests honor `--scope <topic>` and `--facets <list>`; out-of-scope work is simply not iterated. Default concurrency is 3 — three entries run in parallel, balancing throughput against connector rate limits.

If an entry fails (connector error, ingest error, LLM timeout), atlas logs the error to `wiki/outputs/atlas/<run-id>/errors.jsonl` and continues. Disk and permission errors hard-abort with a checkpoint save (see [Resuming a partial run](#resuming-a-partial-run)).

### Phase 7 — Synthesize globals

Three to seven global pages are regenerated every time, regardless of `--facets` and `--scope` — reading already-on-disk topic pages is cheap (~$0.30 total). The bundles are assembled by [`agents/lib/atlas_synthesize.ts`](../agents/lib/atlas_synthesize.ts):

| Global page | Bundle | What it summarises |
|---|---|---|
| `wiki/overview.md` | `assembleOverviewInputs` | One-page architecture + audience-aware TL;DRs per facet |
| `wiki/integrations.md` | `assembleIntegrationsInputs` | API pages + external-service mentions + connector config |
| `wiki/deploy.md` | `assembleDeployInputs` | Dockerfile, compose, workflows, terraform |
| `wiki/commands.md` | `assembleCommandsInputs` | Per-command lifecycle (only when the repo has a `commands/` directory) |
| `wiki/getting-started.md` | `assembleGettingStartedInputs` | First-run install / quickstart |
| `wiki/configuration.md` | `assembleConfigurationInputs` | Top-level config files |
| `wiki/troubleshooting.md` | `assembleTroubleshootingInputs` | Recent error events + drift highlights |

Each bundle is read-only — the assembly walks the wiki and the repo for inputs, hands them to the LLM, and writes the synthesized page back. Source paths are recorded in each global's `sources:` frontmatter so [`/doc-wiki:lint`](commands.md#doc-wikilint--health-check-and-auto-heal)'s `code_ref_drift` and `references_inventory` checks can flag staleness on the next run.

### Phase 8 — Finalize

Five deterministic steps:

1. `lint_checks.js` runs the full check suite, including the new `references_inventory` check that pulls the run's manifest.
2. `wiki/index.md` is updated to list all atlas-tagged pages.
3. The post-op crosslink + tag-harmonize pass runs (skipped when wiki has fewer than three pages).
4. An `op: atlas` event is appended to `log/events.jsonl` carrying the `atlas_run_id`, scope, and outcome counts.
5. The gap report is written at `wiki/outputs/atlas/<run-id>/gap-report.md` (REST endpoints + code-client callsites without documentation, plus uncovered topics from gitlog).

The cost report (actual vs estimated, per-entry breakdown) lands at `wiki/outputs/atlas/<run-id>/cost-report.md`.

## Configuration

Atlas reads from `wiki.config.yaml`. The relevant blocks:

| Block | What it controls | See |
|---|---|---|
| `autonomy.mode` | Whether Phase 3 prompts and how Phase 8 lint fixes apply | [`configuration.md` § autonomy](configuration.md#autonomy-section) |
| `ecosystem.orm` | Which ORM profiles drive Phase 1b entity discovery | [`configuration.md` § ecosystem](configuration.md#ecosystem-section) |
| `ecosystem.rest` | Whether Phase 1b walks REST endpoints, and which custom profiles to load | [`configuration.md` § ecosystem.rest](configuration.md#ecosystem-section) and [`rest-profiles.md`](rest-profiles.md) |
| `lint` | Per-category severity overrides applied in Phase 8 | [`configuration.md` § lint](configuration.md#lint-section) |

CLI flags are documented in [`commands.md` § /doc-wiki:atlas](commands.md#doc-wikiatlas--full-application-documentation).

## Output structure

After a run completes:

```
wiki/
├── overview.md, integrations.md, deploy.md, …  ← Phase 7 globals
├── <topic>/<facet>.md                            ← Phase 6 per-topic atlas pages
├── index.md                                      ← updated in Phase 8
└── outputs/atlas/<run-id>/
    ├── code-inventory.json   ← Phase 1b
    ├── plan.json             ← Phase 4 plan snapshot
    ├── drift-report.md       ← Phase 5 (existing/hybrid only)
    ├── errors.jsonl          ← Phase 6 (only if any entry failed)
    ├── gap-report.md         ← Phase 8
    └── cost-report.md        ← Phase 8

log/events.jsonl              ← appended every phase
```

The `outputs/atlas/<run-id>/` directory is the canonical artifact bundle for one run — `--resume` reads `plan.json` from here.

## Resuming a partial run

If atlas is interrupted (Ctrl-C, crash, disk full), the latest plan snapshot persists. Re-invoke with `--resume`:

```bash
/doc-wiki:atlas --resume
```

The run picks up at the first Phase 6 entry whose page was not committed. Re-discovery is suppressed — the saved plan is the contract; gitlog churn arriving between attempts does not expand scope. This is enforced by reading `wiki/outputs/atlas/<run-id>/plan.json` rather than re-running Phase 2.

`--resume` operates on the most recent run id by default; pass an explicit `--run-id` to resume an older one.

## Cost and cap

Atlas spends LLM time mostly on Phases 6 and 7. Order of magnitude on a typical mid-sized repo:

- Phase 1b inventory: $0 (deterministic).
- Phase 2 topic discovery: ~$0.05–$0.20 depending on repo size.
- Phase 5 validation: scales with the number of existing atlas pages, ~$0.01 per page.
- Phase 6 per-entry ingest: ~$0.10–$0.50 per `(topic, facet)` pair, dominated by source-file size.
- Phase 7 globals: ~$0.30 total.

The `--max-cost` flag is your guard rail. The pre-Phase-6 estimate uses a rolling per-ingest average from your wiki's own history, so it sharpens over time.

## Related commands

- [`/doc-wiki:ingest`](commands.md#doc-wikiingest--fetch-extract-compile) — single-source compile; what Phase 6 dispatches per entry.
- [`/doc-wiki:refresh`](commands.md#doc-wikirefresh--re-fetch-and-update) — re-fetch and update an existing page; used by Phase 6 for stale entries.
- [`/doc-wiki:lint`](commands.md#doc-wikilint--health-check-and-auto-heal) — runs as part of Phase 8; the new `--inventory-run-id` flag scopes the `references_inventory` check to a specific atlas run.
- [`/doc-wiki:query`](commands.md#doc-wikiquery--summary-first-search-synthesis-and-shortest-path) — interactive search over the resulting wiki.
