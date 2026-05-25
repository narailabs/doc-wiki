# Architecture

doc-wiki is a documentation wiki generator and maintainer that runs entirely as Claude Code skills, agents, and TypeScript helper scripts. There is no daemon, no service, no external API to call from your shell — every operation is initiated by a `/doc-wiki:*` slash command, mediated by the orchestrator skill, and carried out by a mix of deterministic TypeScript scripts, three sub-agents, and a single planner-dispatcher (`gather()` from [`narai-primitives`](../connectors.md)) for external sources.

This document explains how the layers fit together, what each script and agent is for, and which architecture invariants are load-bearing.

## Table of contents

- [Three-layer model](#three-layer-model)
- [Layer 1 — Slash commands](#layer-1--slash-commands)
- [Layer 2 — The wiki skill orchestrator](#layer-2--the-wiki-skill-orchestrator)
- [Layer 3 — Execution](#layer-3--execution)
  - [3a. TypeScript scripts](#3a-typescript-scripts)
  - [3b. Agents](#3b-agents)
  - [3c. Shared libraries](#3c-shared-libraries)
  - [3d. `gather()` from `narai-primitives`](#3d-gather-from-narai-primitives)
- [Diagram 2 — `/doc-wiki:ingest` pipeline](#diagram-2-wiki-ingest-pipeline)
- [Diagram 3 — `gather()` internals](#diagram-3-gather-internals)
- [Diagram 4 — `/doc-wiki:atlas` pipeline](#diagram-4-doc-wikiatlas-pipeline)
  - [Phase 5b — archive sweep](#phase-5b--archive-sweep)
- [Reference docs](#reference-docs)
- [Multi-platform wrappers](#multi-platform-wrappers)
- [Architecture contracts](#architecture-contracts)
- [Security baseline](#security-baseline)
- [Testing posture](#testing-posture)
- [Build posture](#build-posture)

## Three-layer model

User input flows top-down through three layers. Each layer has a narrow responsibility:

- **Layer 1 — Slash commands** (9 thin wrapper files) make commands discoverable in each AI tool's autocomplete.
- **Layer 2 — Wiki skill orchestrator** (one `SKILL.md`) is a state machine that reads config, dispatches scripts and agents, and synthesizes pages.
- **Layer 3 — Execution** is a mix of deterministic TypeScript scripts, three derivative agents, shared libraries, and one planner (`gather()`) for external sources.

### Diagram 1: Three-layer model

```mermaid
flowchart TB
    User([User])
    subgraph L1["Layer 1: Slash commands (commands/)"]
        WInit["/doc-wiki:init"]
        WEdit["/doc-wiki:edit"]
        WIngest["/doc-wiki:ingest"]
        WQuery["/doc-wiki:query"]
        WLint["/doc-wiki:lint"]
        WMore["…2 more"]
    end
    subgraph L2["Layer 2: wiki skill orchestrator (skills/doc-wiki/SKILL.md)"]
        Orch["State machine:<br/>parse config → dispatch → synthesize → log"]
    end
    subgraph L3["Layer 3: Execution"]
        Scripts["TypeScript scripts<br/>(skills/doc-wiki/scripts/)<br/>cache · lint · graph · extract · index"]
        Agents["Sub-agents<br/>(agents/)<br/>orm · mermaid · claude-md · readme"]
        Libs["Shared libraries<br/>(agents/lib/)<br/>wiki_db · wiki_orm · mermaid_augment"]
        Gather["gather() from narai-primitives<br/>(planner + parallel dispatcher)"]
        Connectors["7 connectors<br/>db · github · jira · confluence<br/>notion · aws · gcp"]
        Gather --> Connectors
    end
    Storage[("wiki/, raw/, graph/<br/>log/, .wiki-cache/")]

    User --> L1
    L1 --> Orch
    Orch --> Scripts
    Orch --> Agents
    Orch --> Gather
    Scripts --> Libs
    Agents --> Libs
    Scripts --> Storage
    Gather --> Storage
    Agents --> Storage
```

Reading the diagram: the user invokes a slash command, which calls into the skill, which reads the wiki config and dispatches the appropriate combination of scripts, agents, and (for external context) `gather()`. All output lands in the wiki root (`wiki/`, `raw/`, `graph/`, `log/`, `.wiki-cache/`) — there is no remote storage.

## Layer 1 — Slash commands

Eight `commands/*.md` files. Each is a YAML-frontmatter wrapper that registers the command with its host AI tool and forwards arguments into the orchestrator skill.

| Command | What it does |
|---|---|
| [`/doc-wiki:init`](../../commands/init.md) | Bootstrap scaffold + connector setup (Phase 3) + optional atlas chain |
| [`/doc-wiki:atlas`](../../commands/atlas.md) | Full application documentation in a phased pass |
| [`/doc-wiki:ingest`](../../commands/ingest.md) | Fetch, extract, and compile a source; `--refresh` re-fetches previously ingested sources |
| [`/doc-wiki:query`](../../commands/query.md) | Summary-first search + synthesis; `--promote` / `--review` saves the answer as a permanent page |
| [`/doc-wiki:lint`](../../commands/lint.md) | Structural health check and auto-heal |
| [`/doc-wiki:edit`](../../commands/edit.md) | Targeted correction to a single wiki page |
| [`/doc-wiki:unarchive`](../../commands/unarchive.md) | Restore an atlas-archived page from `wiki/_archive/` back into the live wiki |
| [`/doc-wiki:stats`](../../commands/stats.md) | Token efficiency and cost metrics from the event log |

Each wrapper looks roughly like:

```yaml
---
description: Bootstrap a wiki — scaffold directories and default config
argument-hint: '[--path <wiki-root>] [--domain <domain>] [--name <wiki-name>]'
allowed-tools: Skill(doc-wiki)
---

Invoke the `doc-wiki` skill to run the `/doc-wiki:init` workflow ...
Call `Skill(doc-wiki, "init $ARGUMENTS")`.
```

The wrappers exist purely so each command shows up in slash-command autocomplete. They do no work themselves.

For per-command argument and example reference, see [`commands.md`](../commands.md).

## Layer 2 — The wiki skill orchestrator

[`skills/doc-wiki/SKILL.md`](../../skills/doc-wiki/SKILL.md) is a 340+ line state machine. It is loaded into the Claude Code session when any `/doc-wiki:*` command fires, and it routes the command to the correct combination of scripts, agents, and `gather()` calls.

The orchestrator does not contain code — it's instructions for the LLM. Each subcommand section describes:

1. The phases the operation runs through.
2. Which TypeScript script to invoke (with exact CLI args).
3. Which sub-agent to dispatch (when needed).
4. How to interpret results and synthesize a wiki page.
5. What to log to `log/events.jsonl`.

Cross-cutting concerns are documented once and reused across commands:

- **Config I/O** — every command starts by calling `parse_config.ts` to read `wiki.config.yaml`.
- **Caching** — content-hash dedup via `cache_manager.ts` happens before any expensive operation.
- **Event logging** — every operation appends a structured event to `log/events.jsonl` via `event_logger.ts`.
- **Post-op hooks** — after any write op (ingest, edit, query --promote), the orchestrator runs **crosslink** + **tag-harmonize** passes, but only if the wiki has 3+ pages. Skip with `--no-crosslink` or `--no-tag-harmonize`.
- **Autonomy mode** — every change respects the configured autonomy level (`conservative` / `balanced` / `autonomous` / `auto`). See [`skills/doc-wiki/references/autonomy.md`](../../skills/doc-wiki/references/autonomy.md).

## Layer 3 — Execution

Three independent execution surfaces. The orchestrator uses each for what it's good at.

### 3a. TypeScript scripts

Roughly 21 deterministic operations live at [`skills/doc-wiki/scripts/`](../../skills/doc-wiki/scripts/). They compile to sibling `.js` files via `npm run build` and are invoked as `node <script>.js <args>`.

Grouped by purpose:

| Group | Scripts | Purpose |
|---|---|---|
| **Lifecycle** | `init_wiki.ts`, `parse_config.ts`, `apply_config.ts` | Scaffold, read, write `wiki.config.yaml` |
| **Caching** | `cache_manager.ts`, `checkpoint.ts` | SHA256 content-hash dedup; resume support for batch ingests |
| **Event logging** | `event_logger.ts`, `daily_summary.ts` | Append structured JSON to `log/events.jsonl`; aggregate stats |
| **Graph operations** | `graph_ops.ts` | Path queries (shortest, via, all-paths), god-node detection, cluster identification, orphan detection |
| **Quality + lint** | `lint_checks.ts`, `quality_score.ts`, `mermaid_lint.ts`, `summaries_rebuild.ts`, `banlist.ts` | Structural lint, page scoring, Mermaid syntax check, summaries index, anti-repetition memory |
| **Extraction** | `extract_binary.ts`, `extract_multimodal.ts` | PDF / DOCX / PPTX text extraction; audio / video / image transcription |
| **Security** | `security_check.ts` | URL validation, path containment, label sanitization |
| **Indexing** | `mermaid_inject.ts`, `how_to_go_deeper.ts` | Idempotent diagram splicing; "How to Go Deeper" link generation |
| **Hooks** | `hook_installer.ts` | Install PreToolUse hooks into `.claude/settings.json` (used by `/doc-wiki:init` Phase 3, step 6) |
| **Helpers** | `_cli_args.ts`, `_frontmatter.ts`, `_optional.ts`, `_wiki_fs.ts` | Shared argument parsing, YAML frontmatter, optional-dep loader, filesystem utilities |

Every script has matching `*.test.ts` cases under `tests/`. Tests double as the most reliable usage examples — when in doubt about what a script accepts, read its tests.

### 3b. Agents

Four sub-agents live under [`agents/`](../../agents/). Each has its own `AGENT.md` specification.

#### `wiki-orm-agent`

- **Path:** [`agents/wiki-orm-agent/`](../../agents/wiki-orm-agent/)
- **Purpose:** Detect ORM patterns in a codebase and map entities to database tables.
- **Tools:** Bash, Read, Glob, Grep (Serena MCP when available).
- **Output:** A `database-mapping.md` page with a Mermaid ER diagram.
- **Profiles supported (7):** JPA / Hibernate, SQLAlchemy, Django ORM, Prisma, TypeORM, Entity Framework, ActiveRecord.
- **Cross-validation:** When called with a database environment name, the agent cross-validates ORM entities against the live DB schema (via the `wiki_db` library + the policy gate in `narai-primitives`'s `db` connector).

#### `wiki-mermaid-agent`

- **Path:** [`agents/wiki-mermaid-agent/`](../../agents/wiki-mermaid-agent/)
- **Purpose:** Convert structured JSON (from connector envelopes or other sources) into fenced Mermaid blocks and inject them into wiki pages.
- **Tools:** Bash, Read, Write.
- **Constraint:** Purely deterministic — no LLM calls. All operations are string formatting and file I/O.
- **Diagram types:** `erDiagram`, `sequenceDiagram`, `flowchart`, `graph`, `classDiagram`, `stateDiagram`, `gantt`, `pie`, `gitgraph`.

#### `wiki-claude-md-agent`

- **Path:** [`agents/wiki-claude-md-agent/`](../../agents/wiki-claude-md-agent/)
- **Purpose:** Generate and maintain `CLAUDE.md` files (root + per-submodule), preserving user-written content outside `<!-- wiki-managed: start/end -->` markers.
- **Tools:** Bash, Read, Write.
- **Operations:** `generate` (full creation) and `update` (managed-section refresh only).
- **Submodule handling:** Auto-discovers directories with their own `CLAUDE.md`, links them back to root.

#### `wiki-readme-agent`

- **Path:** [`agents/wiki-readme-agent/`](../../agents/wiki-readme-agent/)
- **Purpose:** Repo-root `README.md` maintainer. Reads `wiki/getting-started.md` and the `<!-- wiki-managed: quickstart start/end -->` block of `README.md`, then runs an LLM-driven paragraph-level salvage to produce a fresh quickstart block at the configured depth (`minimal` / `standard` / `generous` from `ecosystem.readme.quickstart_depth`).
- **Tools:** Bash, Read, Write.
- **Dispatch:** Atlas Phase 8 dispatches this agent in parallel with `wiki-claude-md-agent`.
- **Contract:** See [`agents/wiki-readme-agent/AGENT.md`](../../agents/wiki-readme-agent/AGENT.md) for the full spec.

### 3c. Shared libraries

Code that's shared between agents and scripts lives at [`agents/lib/`](../../agents/lib/).

Two library directories:

| Library | Path | Purpose |
|---|---|---|
| `wiki_db` | `agents/lib/wiki_db/` | Connection pooling, async driver abstraction (SQLite, Postgres, MySQL, MSSQL, MongoDB, DynamoDB), policy-gated read-only schema introspection. Used by `wiki-orm-agent` for cross-validation. The connector-side policy gate lives in `narai-primitives`'s `db` connector — `wiki_db` is the wiki-side adapter. |
| `wiki_orm` | `agents/lib/wiki_orm/` | ORM mapper with 7 profiles loaded from YAML at runtime. Profile patterns are validated at load time (bad regex throws `ProfileValueError`). |

Four standalone modules at the same path:

| Module | Purpose |
|---|---|
| `parse_config.ts` | Read/validate `wiki.config.yaml` (used by skill + agents) |
| `source_registry.ts` | Source-to-connector matching (URL/scheme → connector ID). Static `BUILTIN_PATTERNS` list + custom patterns from `wiki.config.yaml`. **Never dispatches a connector** — only classifies sources for `how_to_go_deeper.ts`. |
| `mermaid_format.ts` | Mermaid diagram formatting utilities |
| `mermaid_augment.ts` | Single decoration site: applies wiki-specific `mermaid: { type, title, code }` blocks on top of raw `DispatchResult` envelopes from `gather()`. Called once per `/doc-wiki:ingest`. |

### 3d. `gather()` from `narai-primitives`

External-source fetching does not live in doc-wiki at all. It is delegated to `gather()` from [`narai-primitives`](https://github.com/narailabs/narai-primitives) — a planner + parallel-dispatcher that takes a natural-language prompt and returns context from any subset of seven enabled connectors (`db`, `github`, `jira`, `confluence`, `notion`, `aws`, `gcp`).

doc-wiki calls `gather()` exactly once per `/doc-wiki:ingest`, in step 7 of the pipeline. The hub plans which connectors to invoke, spawns each as a child process, and returns a `DispatchResult[]` where each entry carries either an `envelope` (success) or a structured `error` (failure). The wiki then runs `applyMermaid()` on the results to add wiki-specific Mermaid blocks before compiling the final page.

For the full `gather()` API, the `DispatchResult` envelope shape, and the seven connectors, see [`connectors.md`](../connectors.md).

## Diagram 2: `/doc-wiki:ingest` pipeline

```mermaid
sequenceDiagram
    autonumber
    participant U as User
    participant S as wiki skill
    participant Cfg as parse_config.ts
    participant Cache as cache_manager.ts
    participant Sec as security_check.ts
    participant Ext as extract_binary.ts /<br/>extract_multimodal.ts
    participant G as gather()<br/>(narai-primitives)
    participant Ma as mermaid_augment.ts
    participant Idx as summaries_rebuild.ts
    participant Log as event_logger.ts
    participant FS as wiki/, raw/,<br/>.wiki-cache/

    U->>S: /doc-wiki:ingest <source>
    S->>Cfg: read wiki.config.yaml
    Cfg-->>S: WikiConfig
    S->>Cache: check(SHA256 of source)
    Cache-->>S: hit | miss
    alt cache miss
        S->>Sec: validateUrl / checkPathContainment
        Sec-->>S: ok
        S->>Ext: extract (PDF/DOCX/audio/video?)
        Ext-->>S: extracted text
        S->>S: Read source fully<br/>Surface 3-5 takeaways<br/>+ entity list
        S->>G: gather({ prompt, consumer: "doc-wiki" })
        Note over G: plan via Claude SDK,<br/>dispatch connectors<br/>in parallel
        G-->>S: DispatchResult[]
        S->>Ma: applyMermaid(results)
        Ma-->>S: results + mermaid blocks
        S->>S: Compile wiki page<br/>(frontmatter, claims,<br/>code refs, links)
        S->>FS: write wiki/<topic>/<page>.md
        S->>Idx: rebuild wiki/summaries.md
        Idx-->>FS: write summaries.md
        S->>S: post-op hooks:<br/>crosslink + tag-harmonize<br/>(if 3+ pages)
    end
    S->>Log: append event<br/>(op, source, tokens, duration)
    Log-->>FS: append log/events.jsonl
    S-->>U: page path + summary
```

The numbered steps map to the orchestrator's instructions in [`SKILL.md`](../../skills/doc-wiki/SKILL.md) (search for `### /doc-wiki:ingest`). Steps 1–6 are deterministic. Step 7 is the only place external services are touched. Steps 8–13 are deterministic.

A few subtle behaviors worth knowing:

- **Cache key includes config version.** Bumping `cache_manager.ts`'s version constant invalidates the entire cache — used when extraction logic changes.
- **Mermaid injection is idempotent.** `mermaid_inject.ts` wraps each block in `<!-- wiki-mermaid: <title> start/end -->`; re-ingest replaces in place.
- **Errors from `gather()` are non-fatal.** Each connector failure surfaces as a `DispatchResult.error`; the wiki page still compiles with whatever envelopes succeeded.
- **`applyMermaid` is the single decoration site.** All 7 connectors flow through it. If you need wiki-side Mermaid behavior for a new connector, add it to `mermaid_augment.ts` — never to a connector wrapper.

## Diagram 3: `gather()` internals

How the planner-dispatcher works inside `narai-primitives` itself:

```mermaid
sequenceDiagram
    autonumber
    participant DW as doc-wiki<br/>(/doc-wiki:ingest step 7)
    participant Hub as gather()<br/>narai-primitives/hub
    participant Cfg as loadResolvedConfig<br/>narai-primitives/config
    participant Plan as AgentSdkPlanner<br/>(Claude Agent SDK)
    participant Disp as dispatch.ts
    participant C1 as connector A<br/>(child_process.spawn)
    participant C2 as connector B<br/>(child_process.spawn)
    participant C3 as connector C<br/>(child_process.spawn)

    DW->>Hub: gather({ prompt, consumer: "doc-wiki" })
    Hub->>Cfg: loadResolvedConfig({ consumer })
    Note over Cfg: read ~/.connectors/config.yaml<br/>+ ./.connectors/config.yaml<br/>apply env + consumer overlays
    Cfg-->>Hub: ResolvedConfig
    Hub->>Hub: build system prompt<br/>(concat each enabled connector's<br/>SKILL.md verbatim)
    Hub->>Plan: plan(systemPrompt, userPrompt)
    Plan-->>Hub: JSON plan: [{connector, action, params}, ...]
    Hub->>Hub: validate plan entries<br/>(drop malformed, surface as error)
    par parallel dispatch (concurrency cap = 8)
        Hub->>Disp: dispatch(step 1)
        Disp->>C1: spawn CLI<br/>--action <a> --params <p><br/>NARAI_CONFIG_BLOB=<json>
        C1-->>Disp: stdout = JSON envelope
        Disp-->>Hub: DispatchResult { envelope }
    and
        Hub->>Disp: dispatch(step 2)
        Disp->>C2: spawn CLI ...
        C2-->>Disp: stdout = JSON envelope
        Disp-->>Hub: DispatchResult { envelope }
    and
        Hub->>Disp: dispatch(step 3)
        Disp->>C3: timeout (60s)
        Note over C3,Disp: SIGTERM, then SIGKILL after 2s grace
        Disp-->>Hub: DispatchResult { error: TIMEOUT }
    end
    Hub-->>DW: { plan, results }
```

Three things worth highlighting:

1. **The planner is an LLM call.** `AgentSdkPlanner` (the default) imports `@anthropic-ai/claude-agent-sdk` and asks Claude to choose connectors and actions based on the prompt. Plan steps are validated against each connector's declared actions; malformed steps are dropped (and surfaced as `DispatchResult.error`).
2. **Dispatch is subprocess-based, not in-process.** Each connector runs in its own Node child process so a misbehaving connector can't corrupt the parent. Configuration is passed via the `NARAI_CONFIG_BLOB` env var; credentials are loaded inside the child process by `narai-primitives/credentials`. doc-wiki itself never sees a cleartext token.
3. **Errors are isolated per step.** A timeout, an unauthorized response, or a missing CLI in one connector does not fail the gather — just that step. The caller sees `results[i].error.code` (e.g., `TIMEOUT`, `DISPATCH_FAILED`, `CLI_NOT_FOUND`, `UNAUTHORIZED`) and decides how to handle it.

For the full `gather()` API, plan validation rules, and per-connector envelopes, see [`connectors.md`](../connectors.md).

## Diagram 4: `/doc-wiki:atlas` pipeline

`/doc-wiki:atlas` is a meta-orchestrator: it doesn't replace `/doc-wiki:ingest`, it batches it. The eight phases below run serially; per-topic ingests in Phase 6 may run in parallel within the phase boundary (default concurrency 3).

```mermaid
flowchart TD
    A[/doc-wiki:atlas/] --> P1
    P1[Phase 1: Detect state\natlas_orchestrator.js detect-state] --> P2
    P2[Phase 2: Discover topics\ncode dirs + ORM domains +\nexisting wiki + gitlog churn] --> P3
    P3[Phase 3: Confirm topics\nautonomy-gated, --yes skips] --> P4
    P4[Phase 4: Estimate cost\natlas_orchestrator.js estimate-cost] --> P4D{over --max-cost?}
    P4D -- yes --> ABORT[Abort with hint]
    P4D -- no --> P5{state == fresh?}
    P5 -- yes --> P5B
    P5 -- no --> P5V[Phase 5: Validate existing\nstructural + gitlog +\nsemantic with cache]
    P5V --> P5B
    P5B[Phase 5b: Archive sweep\natlas_archive.js sweep\nautonomy-gated]
    P5B --> P6
    P6[Phase 6: Bootstrap / refresh\nper topic × facet:\n/doc-wiki:ingest --output ...\n/doc-wiki:ingest --refresh --source ...]
    P6 --> P7
    P7[Phase 7: Synthesize globals\nwiki/overview.md\nwiki/integrations.md\nwiki/deploy.md]
    P7 --> P8
    P8[Phase 8: Finalize\n/doc-wiki:lint, update index,\nglobal crosslink + tag-harmonize,\nlog op:atlas, write reports]
    P8 --> DONE[atlas complete]

    classDef llm fill:#fff3cd,stroke:#856404
    classDef det fill:#d4edda,stroke:#155724
    classDef gate fill:#f8d7da,stroke:#721c24
    class P1,P4,P5B,P8 det
    class P2,P3,P5V,P6,P7 llm
    class P4D,P5 gate
```

### Phase 5b — archive sweep

Phase 5b runs between Phase 5 (Validate) and Phase 6 (Bootstrap/refresh). Its purpose is to move atlas-managed pages whose local source paths have been deleted out of the live wiki surface before the refresh pass begins — so atlas doesn't waste cost re-ingesting orphaned content, and synthesis globals (Phase 7) never include stale module documentation.

**Detection via `source-existence`.** The sweep calls `atlas_validate.js source-existence` for each atlas-tagged live page. This subcommand iterates the page's `sources:` frontmatter, skipping URL-scheme entries (which are not a local-archive concern) and checking local paths via `fs.access`. It returns `{ status: "live" | "candidate" | "orphan", missing: string[], ratio: number }`. A page is an `orphan` when `ratio == 1.0` — all local sources are gone. Partially-missing pages (`candidate`) are reported in the drift report but never auto-archived; the default threshold is 1.0, configurable via `ecosystem.archive.partial_threshold`.

**Autonomy gates.** Like every write-capable operation in doc-wiki, the sweep respects the configured autonomy level. Under `conservative`, only a drift-report entry is produced. Under `balanced` (the default), the operator is prompted page-by-page (`Archive wiki/billing/architecture.md? [Y/n/skip-all]`). Under `autonomous` and `auto`, pages are moved without prompting and the action is logged to the event journal.

**Frontmatter mutation.** When a page is archived, the sweep moves the file from `wiki/<topic>/<page>.md` to `wiki/_archive/<topic>/<page>.md` and stamps four new frontmatter fields: `status: deprecated`, `archived_at`, `archive_reason`, and `archived_from` (the original wiki-relative path). The `atlas_facet` and `atlas_run_id` fields are preserved — the page is still an atlas-managed artifact, just in the deprecated state.

**Persistence.** Each archive event is appended to `wiki/_archive_history.jsonl` (newline-delimited JSON, append-only). After the sweep completes, `wiki/_archive/index.md` is rewritten from the history log — newest first, grouped by archive month — so operators always have a browsable listing of what has been archived and when.

**Inbound-link rewrite.** After moving a file, the sweep scans all live pages for markdown links pointing at the now-stale path and rewrites them per the `ecosystem.archive.inbound_links` mode (`rewrite` / `drop` / `leave`; default `rewrite`). The `rewrite` mode appends `(archived)` to the link label and updates the path to `wiki/_archive/…`. This pass is idempotent — re-running on already-rewritten links is a no-op.

**Exclusions after archiving.** Once a page is under `wiki/_archive/`, it is excluded from lint checks (`broken_links`, `code_ref_drift`, `isolated_node`), `summaries_rebuild`, `quality_score`, `graph_ops` path queries, `atlas_synthesize` input bundles, and future atlas Phase 6 refresh iterations. The `_wiki_fs.ts` walker exposes two named helpers to enforce this split: `walkLivePages()` (the default; excludes `_*` directories) and `walkArchivedPages()` (only `wiki/_archive/`).

For the full design, autonomy table, edge cases, and migration notes, see the design spec at [`docs/superpowers/specs/2026-05-24-archive-deprecated-pages-design.md`](../superpowers/specs/2026-05-24-archive-deprecated-pages-design.md). Implementation lives in [`agents/lib/atlas_archive.ts`](../../agents/lib/atlas_archive.ts).

Green = deterministic (TypeScript helpers); yellow = LLM-driven (the orchestrator skill itself); red = decision gates that may abort or branch.

The eight phases map to the orchestrator's instructions in [`SKILL.md`](../../skills/doc-wiki/SKILL.md) (search for `### /doc-wiki:atlas`). The new TypeScript helpers under `skills/doc-wiki/scripts/` are:

- [`atlas_orchestrator.ts`](../../skills/doc-wiki/scripts/atlas_orchestrator.ts) — state detection (Phase 1), cost estimation (Phase 4), plan-snapshot persistence (Phase 6 entry / `--resume`).
- [`atlas_gitlog.ts`](../../skills/doc-wiki/scripts/atlas_gitlog.ts) — `git log --since` parser; classifies changed paths as **stale** (referenced by an existing atlas page), **uncovered** (under a current-run topic but no atlas page), or **unrelated**.
- [`atlas_validate.ts`](../../skills/doc-wiki/scripts/atlas_validate.ts) — `(page-hash, source-hash)` cache for the Phase 5 semantic check, plus a thin wrapper around `lint_checks.ts` for single-page structural validation.
- [`agents/lib/atlas_synthesize.ts`](../../agents/lib/atlas_synthesize.ts) — read-only input bundles for Phase 7 (`overview`, `integrations`, `deploy`).

A few subtle behaviors worth knowing:

- **Plan snapshot is the contract for `--resume`.** Phase 6 saves the topic+facet plan before any ingest; resume reads the snapshot, never re-discovers topics. This prevents mid-run scope creep when gitlog churn arrives between attempts.
- **The additive-re-runs invariant is enforced by `--facets` semantics, not by deletion suppression.** A re-run with `--facets architecture` simply doesn't iterate the other facets in Phase 6 — out-of-scope pages aren't touched, period. Validation (Phase 5) still walks every existing atlas page regardless of `--facets`.
- **Globals are always regenerated.** Phase 7 runs every time, independent of `--facets` and `--scope`. Reading already-on-disk topic pages is cheap (~$0.30 total).
- **Errors are non-fatal except disk/permission.** Connector errors (per-step `gather()` isolation), `/doc-wiki:ingest` errors on a single source, and LLM timeouts (one retry with backoff) all log and continue. Only out-of-disk or permission errors hard-abort with a checkpoint save.

## Reference docs

Five operator manuals live at [`skills/doc-wiki/references/`](../../skills/doc-wiki/references/). The orchestrator skill reads these on demand — they are not loaded upfront.

| Document | What it covers |
|---|---|
| [`autonomy.md`](../../skills/doc-wiki/references/autonomy.md) | Autonomy levels (conservative / balanced / autonomous / auto), per-category overrides, dispute audit inbox |
| [`code-locality.md`](../../skills/doc-wiki/references/code-locality.md) | When to reference code vs copy it; content-hash drift detection |
| [`compilation.md`](../../skills/doc-wiki/references/compilation.md) | Page-type taxonomy (concept / entity / summary / index / lecture / claim / synthesis), required frontmatter, claims metadata, "How to Go Deeper" generation |
| [`operations.md`](../../skills/doc-wiki/references/operations.md) | Detailed specs per operation: codebase markers, ORM patterns, DB detection, Q&A flow, scaffold template, onboarding phases |
| [`quality.md`](../../skills/doc-wiki/references/quality.md) | Quality scoring formula (0.0–1.0), tag philosophy (content-only), Mermaid lint rules |

These are the source of truth for the orchestrator's behavior. The public docs in `docs/` paraphrase them where helpful.

## Multi-platform wrappers

The skill is exposed in five AI tools via wrapper files:

| File | Tool |
|---|---|
| [`AGENTS.md`](../../AGENTS.md) | Codex / OpenAI agents |
| [`GEMINI.md`](../../GEMINI.md) | Gemini / Google AI |
| [`.cursor/rules/wiki.mdc`](../../.cursor/rules/wiki.mdc) | Cursor IDE |
| [`.aider/conventions.md`](../../.aider/conventions.md) | Aider |
| `skills/doc-wiki/SKILL.md` | Claude Code (the canonical, full-detail manual) |

All five point back to the same scripts under `skills/doc-wiki/scripts/` and the same agents under `agents/`. The wrappers exist because each tool has its own slash-command discovery path and rule format; the skill itself is one orchestrator.

## Architecture contracts

These are load-bearing invariants. Implementers must respect them; reviewers should reject changes that violate them.

1. **Database drivers implement `executeReadAsync(conn, sql, params, maxRows, timeoutMs): Promise<ExecuteReadResult>`.** There is no sync `execute` path. Sync drivers (e.g., SQLite's `executeRead`) are adapted at the call site via `adaptDriver` (used by `wiki-orm-agent` and the `wiki_db` library tests).

2. **`getConnection(envName)` is async.** Callers must `await` it. `release` and `shutdown` use identity-based lookup on the awaited handle.

3. **Single source-fetch path through `gather()`.** `/doc-wiki:ingest` step 7 calls `gather()` from `narai-primitives`; doc-wiki does not maintain per-service subagents or wrappers. The hub owns CLI resolution, parallel dispatch, and per-step error isolation; `mermaid_augment.ts` owns wiki-specific decoration.

4. **Credential resolution uses the `narai-primitives/credentials` subpath.** Import `resolveSecret`, `registerProvider`, and provider classes from `narai-primitives/credentials` (absorbed into the bundle in v2.1). Connectors load their own credentials inside the connector process — doc-wiki does not pass credentials into `gather()`.

5. **ORM profile patterns are validated at load time.** `loadProfile()` compiles every regex-valued pattern; a bad pattern throws `ProfileValueError` with the file path and offending pattern.

6. **Source-to-connector matching is data-driven.** `lookupBySource()` in `agents/lib/source_registry.ts` reads a static `BUILTIN_PATTERNS` list (one entry per connector bundled in `narai-primitives`). Custom patterns load via `ecosystem.agents.custom` in `wiki.config.yaml` — no code changes needed to add a new connector mapping. `lookupBySource` never dispatches a connector; it only classifies sources for `how_to_go_deeper.ts`.

7. **No Python in this repo.** All scripts are TypeScript. The only `.py` files are ORM-extractor test fixtures under `agents/lib/wiki_orm/tests/fixtures/{sqlalchemy,django}/`, read as text by the TypeScript tests. Verify with: `find . -name '*.py' -not -path './node_modules/*' -not -path './wiki-workspace/*' -not -path './.worktrees/*/node_modules/*'`.

8. **Idempotent Mermaid injection.** `mermaid_inject.ts` wraps blocks in `<!-- wiki-mermaid: <title> start/end -->` markers. Re-ingest replaces stale diagrams in place; never duplicates.

9. **Post-op hooks run automatically.** After write operations (ingest, fix, promote, refresh), crosslink and tag-harmonize passes run if the wiki has 3+ pages. Skip with `--no-crosslink` or `--no-tag-harmonize`.

10. **Autonomy mode controls writes.** Every change respects the configured autonomy level. Per-category overrides allow finer control (e.g., `auto` for crosslinks but `balanced` for new pages).

These contracts are mirrored verbatim in `CLAUDE.md` for Claude Code's project-memory layer; both must stay in sync if either is updated.

## Security baseline

The connector toolkit (in `narai-primitives/toolkit`) provides:

- **`validateUrl(url)`** — only `http://` and `https://` schemes are accepted.
- **`checkPathContainment(path, root)`** — symlink-resolved containment check (TOCTOU note: not atomic; relies on running on a private filesystem like a developer workstation, CI runner, or sandboxed container).
- **`fetchWithCaps(url, init?, caps?)`** — HTTP fetch with size cap (default 50 MB) and timeout (default 60 s), enforced via streaming + `AbortController`.
- **`sanitizeLabel(label, maxLen?)`** — strip control chars (`U+0000–001F`, `U+007F–009F`), HTML-escape, cap length.

Doc-wiki itself adds [`security_check.ts`](../../skills/doc-wiki/scripts/security_check.ts) for URL validation prior to ingest. The full security posture is documented in [`compilation.md`](../../skills/doc-wiki/references/compilation.md) and [`operations.md`](../../skills/doc-wiki/references/operations.md).

The `db` connector adds a guard-rail policy on top of all this — see [`connectors.md`](../connectors.md#db) for the ALLOW / DENY / ESCALATE / PRESENT_ONLY decisions.

## Testing posture

| Suite | Location | Approximate count |
|---|---|---|
| Wiki scripts | `skills/doc-wiki/scripts/tests/` | ~150 |
| `wiki_db` library | `agents/lib/wiki_db/tests/` | ~200 |
| ORM mapper | `agents/lib/wiki_orm/tests/` | ~100 |
| `wiki-claude-md-agent` | `agents/wiki-claude-md-agent/scripts/tests/` | ~30 |
| `wiki-mermaid-agent` | `agents/wiki-mermaid-agent/scripts/tests/` | ~20 |
| **Full suite** | `.claude/**/*.test.ts` | **934 passed + 5 skipped** |

The 5 skipped tests are live-database integration tests, gated behind `TEST_LIVE_*` environment variables. They are intentionally not part of CI.

```sh
npm test                                            # full suite
npm run test:coverage                               # with v8 coverage
npm run test:watch                                  # watch mode
npx vitest run skills/doc-wiki/scripts/tests/   # focused
```

## Build posture

doc-wiki is a TypeScript project with two `tsconfig` files:

- [`tsconfig.json`](../../tsconfig.json) — typecheck config (`tsc --noEmit`); `npm run typecheck`.
- [`tsconfig.build.json`](../../tsconfig.build.json) — build config (`tsc -b`); `npm run build`. Emits sibling `.js` files next to every `.ts` under `skills/doc-wiki/scripts/` and `agents/lib/`.

ES modules (`"type": "module"`), strict TypeScript, ES2022 target. There is no bundler; scripts are loaded by `node` directly.

For dev-mode TypeScript execution (skip the build step), use `npx tsx <script>.ts <args>`.
