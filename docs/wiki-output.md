# What your wiki looks like

A guide to the artifacts doc-wiki produces — the directory layout, the anatomy of a generated page, the index files, the typed graph, and how much of it is safe to hand-edit.

If you've just run `/doc-wiki:init` and `/doc-wiki:ingest`, this is what you have on disk and how to read it.

## Table of contents

- [The wiki directory tree](#the-wiki-directory-tree)
- [Anatomy of a generated page](#anatomy-of-a-generated-page)
- [`wiki/summaries.md`](#wikisummariesmd)
- [`wiki/index.md`](#wikiindexmd)
- [`graph/edges.jsonl`](#graphedgesjsonl)
- [Conventions](#conventions)
- [Editing pages by hand](#editing-pages-by-hand)

## The wiki directory tree

After `/doc-wiki:init`, the wiki root looks like this:

```
<wiki-root>/                     # default: docs/<app-name>-wiki/
├── wiki.config.yaml             # per-wiki config (name, domain, autonomy mode, ecosystem)
├── wiki/
│   ├── index.md                 # master catalog of every wiki page
│   ├── summaries.md             # progressive-disclosure index (loaded first by /query)
│   ├── overview.md              # evolving big-picture synthesis
│   └── <topic>/<page>.md        # compiled pages (after first /ingest)
├── raw/                         # raw fetched sources (cached)
├── graph/
│   └── edges.jsonl              # typed relationships between pages
├── audit/                       # audit logs from policy-gated ops (db connector)
├── log/
│   └── events.jsonl             # operation event stream (every /doc-wiki:* call logs here)
├── outputs/
│   ├── queries/                 # archived /doc-wiki:query answers
│   │   ├── <timestamp>.md       # each /query writes one of these
│   │   ├── .promoted/           # archives that have been /promote'd (excluded from triage)
│   │   └── .deleted/            # archives that have been /promote --review --delete'd
│   └── atlas/<run-id>/          # /doc-wiki:atlas outputs (per run)
│       ├── code-inventory.json  # ORM entities + REST endpoints + code-client callsites
│       ├── plan.json            # plan snapshot for --resume
│       ├── drift-report.md      # Phase 5 drift findings (existing/hybrid wikis only)
│       ├── gap-report.md        # Phase 8: undocumented endpoints + uncovered topics
│       └── cost-report.md       # Phase 8: actual vs estimated cost
├── .wiki-cache/                 # SHA256 content-hash cache for incremental processing
├── .wiki-checkpoint.json        # resume state (transient; cleared after successful runs)
└── .wiki-ignore                 # gitignore-style filter for ingestion
```

What's worth committing to git: `wiki.config.yaml`, the `wiki/` tree, `graph/edges.jsonl`. What's worth gitignoring: `.wiki-cache/`, `.wiki-checkpoint.json`, `log/events.jsonl`, `outputs/queries/` (it's user-specific transcript history). `raw/` is your call — useful for offline operation, not strictly needed.

## Anatomy of a generated page

Here's a real compiled page (excerpted from a sample auth-service wiki). Every wiki page follows this shape — frontmatter block, narrative body, optional Mermaid diagrams, "How to Go Deeper" footer.

````markdown
---
title: Authentication and Session Management
type: concept
tags: [authentication, jwt, session-management, refresh-token, rs256, postgresql]
sources: [raw/auth/architecture.md]
created: 2026-04-14
updated: 2026-04-14
quality: 0.85
summary: >
  The service combines short-lived RS256-signed JWT access tokens with
  server-side sessions persisted in PostgreSQL. Refresh flows through
  /auth/refresh rotate refresh tokens; logout revokes the session and
  deletes associated refresh-token rows.
---

# Authentication and Session Management

The auth service uses a **hybrid model**: stateless JWT access tokens for
per-request authorization, combined with server-side session records that
give operators the ability to forcibly revoke access...

<!-- wiki-mermaid: refresh-flow start -->
```mermaid
sequenceDiagram
    participant Client
    participant Auth as Auth Service
    participant DB as PostgreSQL
    Client->>Auth: POST /auth/refresh (cookie: session_id)
    Auth->>DB: SELECT * FROM sessions WHERE session_id = ?
    ...
```
<!-- wiki-mermaid: refresh-flow end -->

## How to Go Deeper

- **Live source:** [`raw/auth/architecture.md`](../../raw/auth/architecture.md)
- **Database:** inspect schema with `wiki agent db-query dev "\d sessions"`
- **JWKS endpoint:** fetch `GET /.well-known/jwks.json`
````

### Frontmatter fields

| Field | Type | Required? | Purpose |
|---|---|---|---|
| `title` | string | yes | Display name; also seeds the slug |
| `type` | string | yes | One of `concept`, `entity`, `summary`, `index`, `lecture`, `claim`, `synthesis` |
| `tags` | string list | yes | Content-only concept tags (no structural / temporal / metadata tags) |
| `sources` | path list | yes | Original source files / URLs the page was compiled from |
| `created` / `updated` | ISO-8601 date | yes | First create + most recent change |
| `quality` | float (0.0–1.0) | yes | Last quality-score-pass result (see [`autonomy-modes.md`](autonomy-modes.md)) |
| `summary` | string (≤80 words) | yes | One-paragraph summary; copied into `wiki/summaries.md` |
| `atlas_facet` | string | atlas-only | Which facet generated this page (`architecture`, `data-model`, etc.) |
| `atlas_run_id` | timestamp | atlas-only | Which atlas run wrote this page; lets re-runs identify their own work |

### Body sections

A typical page has, in order:

1. **TL;DR / opening narrative** — 2–4 paragraphs of plain prose.
2. **Mermaid diagrams** — wrapped in `<!-- wiki-mermaid: <name> start/end -->` markers (see [Editing](#editing-pages-by-hand) below).
3. **Detail sections** — code-anchored explanations, with file references that include content hashes for drift detection.
4. **"How to Go Deeper"** — generated by [`how_to_go_deeper.ts`](../skills/doc-wiki/scripts/how_to_go_deeper.ts), one bullet per source class (live source, related ticket, database, etc.).

### Auto-managed regions

Two kinds of regions are auto-regenerated on `refresh` / `lint --fix`:

- **`<!-- wiki-mermaid: <name> start/end -->`** — the Mermaid block between these markers comes from `mermaid_inject.ts`. Hand-edits inside the markers are overwritten.
- **`<!-- wiki-managed: <section> start/end -->`** — used by `wiki-claude-md-agent` for cross-vault sync. Same rule.

Everything **outside** marker pairs is yours — narrative, additional sections, hand-curated examples, your prose. doc-wiki's auto-regen passes leave that content alone.

## `wiki/summaries.md`

Loaded first by `/doc-wiki:query`. Acts as a progressive-disclosure index — one ~50-token summary per page, scored against your question before any full page is read. This is what makes queries cheap.

```markdown
<!-- wiki-managed: summaries start -->
## auth/authentication.md
The service combines short-lived RS256-signed JWT access tokens with
server-side sessions persisted in PostgreSQL. Refresh flows through
/auth/refresh rotate refresh tokens; logout revokes the session.
**Tags:** authentication, jwt, session-management, refresh-token

## billing/invoices.md
Invoice generation runs as a nightly batch over the `subscriptions` table,
emits PDFs to S3, and records issued invoices in the `invoices` table...
<!-- wiki-managed: summaries end -->

<!-- wiki-managed: banlist start -->
## Anti-repetition memory

These claims have been retracted in past lint passes — do not reintroduce:
- "Sessions are stored in Redis." (failure_reason: confused with cache layer)
<!-- wiki-managed: banlist end -->
```

The **banlist** is appended deterministically by `banlist.ts` after `lint --fix` finds and removes a stale claim. Future ingests check it before writing — prevents the same wrong claim from being re-introduced.

## `wiki/index.md`

Master catalog of every wiki page, grouped by topic. Auto-generated; updated on every `/doc-wiki:ingest` and `/doc-wiki:atlas` Phase 8.

```markdown
# my-app-wiki — Index

## Auth (3 pages)
- [Authentication and Session Management](auth/authentication.md) — concept, quality 0.85
- [JWT Validation](auth/jwt.md) — concept, quality 0.78
- [Session Schema](auth/sessions.md) — entity, quality 0.92

## Billing (2 pages)
- [Invoices](billing/invoices.md) — concept, quality 0.81
- ...
```

You can sort, group, or annotate this file by hand — it's regenerated additively, your edits outside the auto-managed sections are preserved.

## `graph/edges.jsonl`

Typed-edge graph used by `/doc-wiki:query --from <a> --to <b>` (path mode) and the `lint` orphan / isolated-node checks. Each line is one JSON object:

```jsonl
{"from":"auth/authentication.md","to":"auth/jwt.md","type":"supports","provenance":"EXTRACTED","weight":0.9}
{"from":"auth/jwt.md","to":"infra/redis.md","type":"contradicts","provenance":"INFERRED","weight":0.7}
{"from":"billing/invoices.md","to":"billing/subscriptions.md","type":"extends","provenance":"EXTRACTED","weight":0.95}
```

| Field | Type | Meaning |
|---|---|---|
| `from` / `to` | path | Wiki-relative page paths (the edge endpoints) |
| `type` | enum | `supports`, `contradicts`, `extends`, `supersedes` |
| `provenance` | enum | `EXTRACTED` (from source), `INFERRED` (from LLM analysis), `AMBIGUOUS` (manual review needed) |
| `weight` | float (0.0–1.0) | Confidence; used to rank paths in path-mode queries |

The graph is regenerated additively by the crosslink post-hook (runs after `/doc-wiki:ingest` when ≥3 pages exist). Hand-edits to `edges.jsonl` are preserved unless they contradict an `EXTRACTED` finding.

## Conventions

- **Page paths** use `kebab-case` slugs and live under `wiki/<topic>/<page>.md`. The topic dir is inferred from frontmatter / source paths during compilation.
- **Cross-references** use standard markdown links (`[text](path.md)`) — **not** wikilinks (`[[Page]]`). This keeps the wiki readable in any markdown viewer (GitHub, Obsidian, mkdocs).
- **Tags** are content-only (concepts the page discusses). Don't use tags for page type, age, status, or topic — those go in `type`, `created`/`updated`, frontmatter quality, and the directory structure respectively.
- **Source paths** in frontmatter are always relative to the wiki root (e.g. `raw/auth/architecture.md` or `../src/auth/middleware.ts`).
- **Code references** include a content hash so `/doc-wiki:lint` can detect when the underlying source has drifted from what the wiki page describes.

## Editing pages by hand

**Yes, you can edit any wiki page by hand.** doc-wiki is markdown-out, no proprietary format.

What survives auto-regen:
- ✅ Narrative prose outside marker regions.
- ✅ Custom sections you add (e.g. "Internal notes", "Related JIRA tickets I'm watching").
- ✅ Hand-edited frontmatter values (so long as you keep the required fields valid).
- ✅ Re-ordered or hand-curated entries in `wiki/index.md`.

What gets overwritten on `refresh` / `lint --fix` / next `/doc-wiki:ingest` of the same source:
- ❌ Anything inside `<!-- wiki-mermaid: ... -->` markers.
- ❌ Anything inside `<!-- wiki-managed: ... -->` markers.
- ❌ Auto-derived frontmatter fields when the source has changed: `summary`, `tags`, `quality`, `updated`, the source-side hash inside code references.

For diff-reviewed targeted edits (where you want the LLM to propose a change and show you the diff before applying), use:

```text
/doc-wiki:edit wiki/auth/authentication.md "the SQL example uses the old schema name"
```

This reads the page, drafts a fix matching your description, shows a diff, and applies on confirm (or auto-applies in `autonomous` / `auto` modes).

## See also

- [`commands.md`](commands.md) — every command that produces or modifies these artifacts.
- [`configuration.md`](configuration.md) — the `wiki.config.yaml` schema that controls page compilation.
- [`autonomy-modes.md`](autonomy-modes.md) — what each mode auto-regenerates vs prompts on.
- [`internals/architecture.md`](internals/architecture.md) — the ingest pipeline that produces these artifacts.
