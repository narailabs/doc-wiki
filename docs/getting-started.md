# Getting Started

A run-along tutorial from a brand-new repo to a queryable wiki with a few pages, an archived query you can promote, and a feel for the maintenance loop. Plan on **~30 minutes** the first time.

If you only want the install + setup + first-query path, [`README.md`](../README.md) covers that more concisely. This doc takes you further — through atlas, query, promote, refresh, and the maintenance loop.

> **Conventions.** Lines starting with `$` are shell commands; lines starting with `/` are slash commands typed into Claude Code (or Codex / Gemini / Cursor / Aider). Output blocks are illustrative — yours will differ in detail.

## Table of contents

- [Prerequisites](#0-prerequisites)
- [Install doc-wiki](#1-install-doc-wiki)
- [Open your codebase](#2-open-your-codebase)
- [`/doc-wiki:init` — scaffold + onboard](#3-doc-wikiinit--scaffold-and-onboard)
- [`/doc-wiki:ingest`](#4-doc-wikiingest--your-first-source)
- [Ingest more sources / atlas shortcut](#5-ingest-more-sources)
- [`/doc-wiki:query`](#6-doc-wikiquery--ask-a-question)
- [Promoting a good answer](#7-promoting-a-good-answer)
- [Keeping sources current](#8-keeping-sources-current)
- [`/doc-wiki:lint` and `/doc-wiki:edit`](#9-doc-wikilint-and-doc-wikiedit--health-checks)
- [`/doc-wiki:stats`](#10-doc-wikistats--token-and-cost-metrics)
- [The maintenance loop](#11-the-maintenance-loop)
- [Where to go next](#where-to-go-next)

## 0. Prerequisites

- **Node 20.x.** Run `node --version`. Node 21+ isn't supported because some upstream dependencies (`better-sqlite3`, `pdfjs-dist`) haven't shipped Node-21 binaries. Use `nvm install 20` if needed.
- **Claude Code, Codex, Gemini, Cursor, or Aider.** All five route into the same orchestrator skill via the wrappers shipped at the repo root.
- **Optional:** credentials for any external service you want doc-wiki to read from (Jira, Confluence, GitHub, Notion, AWS, GCP, a database). You can skip these now — `/doc-wiki:init` Phase 2 (Onboarding) will prompt for them — and most of this tutorial works with local files only.

## 1. Install doc-wiki

The recommended path is the [NarAI marketplace](https://github.com/narailabs/narai-claude-plugins). One-time setup, then the slash commands appear in every Claude Code session:

```sh
$ claude plugin marketplace add narailabs/narai-claude-plugins
$ claude plugin install doc-wiki@narai
```

Or, skip the marketplace and install directly:

```sh
$ claude plugin install narailabs/doc-wiki
```

Either way, the seven `/doc-wiki:*` commands are now available. Confirm by typing `/` in a Claude Code session — you should see `doc-wiki:init`, `doc-wiki:atlas`, `doc-wiki:ingest`, and friends in autocomplete.

> **Building from source instead?** Only needed if you're contributing to doc-wiki itself. See [`../CONTRIBUTING.md`](../CONTRIBUTING.md).

## 2. Open your codebase

The slash commands run in **whatever project Claude Code currently has open** — they don't need to live next to the doc-wiki source. Open the repo you want to document; the wiki will be scaffolded inside it.

For the rest of this walkthrough, assume you're documenting an auth service with a `package.json`, a `README.md`, a `src/` directory, and a Postgres database. Adapt commands to your specifics.

## 3. `/doc-wiki:init` — scaffold and onboard

```text
/doc-wiki:init
```

That's the whole command. Optional flags:

| Flag | Default | Purpose |
|---|---|---|
| `--path <wiki-root>` | `docs/<app-name>-wiki/` (inferred from `package.json`) | Where to put the wiki |
| `--domain "<domain>"` | `general` | Broad topic, e.g. `backend-services` |
| `--name "<wiki-name>"` | (project name) | Appears in `wiki.config.yaml` and `wiki/overview.md` |

`/doc-wiki:init` runs a **four-phase flow**:

**Phase 1 — scaffold.** Creates `wiki.config.yaml` and the directory tree:

```
<wiki-root>/
├── wiki.config.yaml          # config
├── wiki/
│   ├── index.md              # master catalog (empty)
│   ├── summaries.md          # enriched summary index (empty)
│   └── overview.md           # evolving big-picture synthesis
├── raw/                      # raw fetched sources (cached)
├── graph/edges.jsonl         # typed relationships between pages
├── audit/                    # audit inbox for policy-gated ops
├── log/events.jsonl          # operation event stream
├── outputs/queries/          # archived /doc-wiki:query answers
├── .wiki-cache/              # content-hash dedup cache
└── .wiki-ignore              # gitignore-style filter for ingestion
```

**Phase 2 — onboarding Q&A.** Six interactive steps that teach doc-wiki about your project:

### Onboarding step 1 — language and framework

Scans for marker files (`pom.xml`, `package.json`, `requirements.txt`, `go.mod`, `Cargo.toml`, `Gemfile`, `*.csproj`, `*.sln`):

```
Detected language: TypeScript / Node.js (from package.json)
Confirm? [Y/n]
```

Press Enter to accept, or type the correct stack.

### Onboarding step 2 — ORM detection

Dispatches the `wiki-orm-agent` to scan for entity definitions across seven supported profiles: JPA, SQLAlchemy, Django, Prisma, TypeORM, Entity Framework, ActiveRecord.

```
Detected ORM: Prisma (3 models in prisma/schema.prisma)
Models: User, Session, RefreshToken
Confirm? [Y/n]
```

If you have no ORM, say no — the rest of the flow still works.

### Onboarding step 3 — database

Reads `docker-compose.yml`, `.env`, ORM config, and connection strings, **redacting credentials** before showing you what was found.

### Onboarding step 4 — six external-service questions

Yes/no questions for: Jira, Confluence, GCP, AWS, Notion, GitHub. Your answers populate `consumers.doc-wiki` in the connector config.

### Onboarding step 4b — connector access

For every "yes" you gave, doc-wiki asks one credential question and writes a starter `~/.connectors/config.yaml`:

```
Where does your Jira API token live?
(env var name, keychain label, file path, or cloud secret)
```

You can answer with any credential ref form:

| Form | Means |
|---|---|
| `env:JIRA_API_TOKEN` | environment variable |
| `keychain:jira-pat` | OS keychain entry (macOS Keychain or libsecret) |
| `file:~/.secrets/jira` | file contents (with permission check) |
| `cloud:aws-secret/<arn>` | AWS Secrets Manager |
| `cloud:gcp-secret/<resource>` | GCP Secret Manager |

Resolution is **lazy**: `narai-primitives` only fetches the secret when a connector actually runs, and only inside the connector's subprocess. doc-wiki itself never sees the cleartext value.

### Onboarding step 5 — autonomy mode

Pick one:

| Mode | Behavior |
|---|---|
| `conservative` | Ask before every write |
| `balanced` (default) | Auto-fix safe changes, ask for structural changes |
| `autonomous` | Auto-fix everything that scores above the quality threshold |
| `auto` | Same as autonomous, skip user prompts (CI / batch) |

Stick with `balanced` for your first wiki. You can change it later by editing `wiki.config.yaml`. See [`autonomy-modes.md`](autonomy-modes.md) for full guidance.

### Onboarding step 6 — hooks and multimodal deps

Offers to install platform hooks (skip if unsure), then asks about optional multimodal extraction tools (`faster-whisper` for audio transcription, `yt-dlp` for YouTube). `Skip` is fine if you're only ingesting code and text.

By the time onboarding finishes you have a populated `wiki.config.yaml` and (if any external services were enabled) `~/.connectors/config.yaml`.

**Phase 3 — atlas decision.** Offers to kick off `/doc-wiki:atlas` immediately for a comprehensive first-run sweep. Answering no leaves the wiki ready for incremental `/doc-wiki:ingest` runs.

On an already-initialized wiki, re-running `/doc-wiki:init` prompts "Wiki already initialized. Re-run onboarding?" — choosing yes skips the scaffold phase and re-runs the onboarding Q&A only.

> **Why `docs/<app-name>-wiki/`?** Obsidian and most other markdown-vault tools name a vault after its containing folder. Putting the wiki at `docs/<app-name>-wiki/` means anyone who opens that folder as a vault gets a vault titled with the app's name rather than a generic `wiki` — recognizable in vault switchers and cross-vault links.

**Look up more:** [`commands.md` § /doc-wiki:init](commands.md#doc-wikiinit--bootstrap-and-onboard-a-wiki), [`wiki-output.md`](wiki-output.md) for what each subdir holds, [`configuration.md`](configuration.md), [`connectors.md`](connectors.md).

## 4. `/doc-wiki:ingest` — your first source

Pick something small. Your `README.md` is a natural starting point:

```text
/doc-wiki:ingest README.md
```

Under the hood this kicks off a 13-step pipeline (full diagram in [`internals/architecture.md`](internals/architecture.md#diagram-2-wiki-ingest-pipeline)). The user-visible result: a new compiled page appears under `wiki/`, `wiki/index.md` gains a bullet, and `wiki/summaries.md` gains a one-paragraph summary.

Here's a real excerpt from a generated page so you know what to expect:

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

```mermaid
sequenceDiagram
    participant Client
    participant Auth as Auth Service
    participant DB as PostgreSQL
    Client->>Auth: POST /auth/refresh (cookie: session_id)
    Auth->>DB: SELECT * FROM sessions WHERE session_id = ?
    ...
```

## How to Go Deeper

- **Live source:** [`raw/auth/architecture.md`](../../raw/auth/architecture.md)
- **Database:** inspect schema with `wiki agent db-query dev "\d sessions"`
- **JWKS endpoint:** fetch `GET /.well-known/jwks.json`
````

For the full anatomy (every frontmatter field, marker regions, what regenerates), see [`wiki-output.md`](wiki-output.md).

`/doc-wiki:ingest` accepts files, folders, URLs, and pasted text:

```text
/doc-wiki:ingest src/auth/                                       # whole folder
/doc-wiki:ingest https://your-org.atlassian.net/browse/AUTH-123  # only if Jira is enabled
/doc-wiki:ingest https://github.com/narailabs/doc-wiki           # GitHub repo
/doc-wiki:ingest /path/to/design-spec.pdf                        # binary extraction
```

Two behaviors worth knowing:

- **Caching.** SHA256-hashes every source and skips re-ingesting unchanged content. Re-running `/doc-wiki:ingest README.md` immediately after the first call is a no-op.
- **Folder checkpointing.** `/doc-wiki:ingest src/` runs the pipeline once per file with a checkpoint after each. If you interrupt it (Ctrl+C, lost connection), re-running picks up where it stopped.

**Look up more:** [`commands.md` § /doc-wiki:ingest](commands.md#doc-wikiingest--fetch-extract-compile), [`internals/architecture.md`](internals/architecture.md), [`connectors.md`](connectors.md).

## 5. Ingest more sources

A wiki with one page isn't a wiki. Run `/doc-wiki:ingest` two or three more times across different kinds of sources to seed coverage:

- A core source folder: `/doc-wiki:ingest src/auth/`
- A design doc: `/doc-wiki:ingest docs/auth-design.md`
- A linked Jira ticket (if enabled): `/doc-wiki:ingest https://your-org.atlassian.net/browse/AUTH-123`

After three or four pages exist, the post-operation hooks (crosslink and tag-harmonize) start adding inline links and concept tags across pages — that's what gives the wiki its graph structure.

### Bulk shortcut — `/doc-wiki:atlas`

If running `/doc-wiki:ingest` five or ten times by hand feels tedious, `/doc-wiki:atlas` does the whole sweep in one phased pass:

```text
/doc-wiki:atlas --dry-run    # see the plan + cost estimate, no writes
/doc-wiki:atlas              # for real
```

Atlas auto-discovers topics (top-level code dirs, ORM domains, existing wiki dirs, gitlog churn, CLI commands), confirms with you, then fires `/doc-wiki:ingest` per `(topic × facet)` pair (architecture / data-model / environments / api / operations) and synthesizes 3–7 global aggregation pages (`overview.md`, `integrations.md`, `deploy.md`, possibly `commands.md` / `getting-started.md` / `configuration.md` / `troubleshooting.md`).

A few flags worth knowing:

- `--facets architecture,data-model` — only those facets per topic. **Re-runs are additive** — narrowing the facet set on a re-run never deletes pages from a prior wider run.
- `--scope auth` — restrict to one topic for incremental work.
- `--max-cost <usd>` — default `200`; aborts pre-write if estimate exceeds.
- `--validate-mode shallow|full` — semantically check existing atlas pages on re-runs.

Use atlas for comprehensive bootstrap or periodic audit; use ingest for incremental day-to-day growth.

**Look up more:** [`atlas.md`](atlas.md), [`recipes.md` § recipe 2](recipes.md#2-document-an-entire-codebase-in-one-pass).

## 6. `/doc-wiki:query` — ask a question

The wiki is now queryable:

```text
/doc-wiki:query "How does authentication work in this repo?"
```

The flow:

1. Reads `wiki/summaries.md` (one ~50-token summary per page).
2. Scores every summary against your question.
3. Loads the top-N matching pages in full.
4. Follows their inline links up to `--max-depth` hops (default 3).
5. Synthesizes an answer with inline citations.
6. Surfaces gaps — questions the wiki can't answer.
7. Archives the full transcript to `wiki/outputs/queries/<timestamp>.md`.

The answer comes back inline with markdown citations to the wiki pages it drew from. You can keep asking follow-ups; each gets archived.

**Path mode** — shortest connection between two concepts via the typed-edge graph:

```text
/doc-wiki:query --from auth --to billing --via session --max-hops 4
```

Useful for "how do these two parts of the system relate?" questions.

**Look up more:** [`commands.md` § /doc-wiki:query](commands.md#doc-wikiquery--summary-first-search-synthesis-and-shortest-path).

## 7. Promoting a good answer

Some queries produce answers worth keeping permanently. After a query you like, you'll see a post-answer prompt: "Save this answer as a permanent wiki page?" — accepting it promotes the archive automatically.

You can also promote explicitly:

```text
/doc-wiki:query --promote last
```

doc-wiki resolves `last` to the most-recent archive, compiles it into a permanent wiki page, places it under `wiki/<topic>/<slug>.md`, updates indexes, and moves the archive to `outputs/queries/.promoted/`.

Other target forms work too:

```text
/doc-wiki:query --promote last --topic auth                   # force the topic directory
/doc-wiki:query --promote 2                                   # second-most-recent archive
/doc-wiki:query --promote outputs/queries/2026-04-28T10-15.md # explicit path
```

This is the **feedback loop** worth internalizing: **query exposes what's missing → promote fills the gap → next query is faster**. Wikis grow by use, not by upfront planning.

**Bulk triage** when archives have piled up:

```text
/doc-wiki:query --review --since 7d
```

Walks every archive from the last week and asks `[P]romote / [S]kip / [D]elete / [A]bort`. Already-covered insights are auto-skipped under `balanced` autonomy.

**Look up more:** [`commands.md` § /doc-wiki:query promote mode](commands.md#promote-mode), [`recipes.md` § recipe 3](recipes.md#3-grow-the-wiki-by-feedback-loop).

## 8. Keeping sources current

Upstream sources change. To re-fetch and re-compile changed pages:

```text
/doc-wiki:ingest --refresh --all
```

Either `--source <one-source>` or `--all` is required. doc-wiki reads `log/events.jsonl` to find every source it has ever ingested, re-fetches them through the same connectors, and re-compiles only the pages whose content hash changed.

Typical cadence: weekly. Pair with `/schedule` for unattended runs.

**Look up more:** [`commands.md` § /doc-wiki:ingest refresh mode](commands.md#refresh-mode).

## 9. `/doc-wiki:lint` and `/doc-wiki:edit` — health checks

Run lint after a batch of ingests to catch structural problems:

```text
/doc-wiki:lint
```

Checks include broken links, missing frontmatter, orphan pages, code-ref drift (a wiki page references code whose content hash has changed), provenance gaps, stale pages (>90 days). Output is a categorized report.

Auto-heal the safe categories under your configured autonomy mode:

```text
/doc-wiki:lint --fix
```

For a targeted edit on one page:

```text
/doc-wiki:edit wiki/auth/authentication.md "frontmatter is missing the security tag"
```

doc-wiki reads the page, drafts the change matching the description, shows a diff, applies on confirm (or auto-applies in `autonomous` / `auto` modes).

**Look up more:** [`commands.md` § /doc-wiki:lint](commands.md#doc-wikilint--health-check-and-auto-heal), [`autonomy-modes.md`](autonomy-modes.md).

## 10. `/doc-wiki:stats` — token and cost metrics

Token usage and cost are tracked in `log/events.jsonl`. Aggregate them:

```text
/doc-wiki:stats --since 7d --per-agent
```

You'll see total tokens in/out, p50/p95 reduction ratios (tokens read versus tokens kept in answers — your wiki is doing its job if this is high), per-operation costs, and a per-agent breakdown including connector calls.

Useful for "is the cache hitting?" or "is one connector dominating cost?" sanity checks.

**Look up more:** [`commands.md` § /doc-wiki:stats](commands.md#doc-wikistats--token-efficiency-and-cost-metrics).

## 11. The maintenance loop

Once you have a working wiki, the steady-state cadence:

```text
# whenever new code/docs land
/doc-wiki:ingest <new-source>

# whenever you have a question
/doc-wiki:query "<question>"

# weekly (cron-friendly via /schedule)
/doc-wiki:ingest --refresh --all
/doc-wiki:lint --fix
/doc-wiki:query --review --since 7d
/doc-wiki:stats --since 7d
```

That's the whole loop. The wiki gets richer the more you use it: each query exposes a coverage gap, each promote fills one, each refresh keeps it from going stale, each lint catches drift before it compounds.

For unattended scheduled execution, see [`recipes.md` § recipe 4](recipes.md#4-weekly-maintenance) and consider switching `autonomy.mode` to `auto` in `wiki.config.yaml` so prompts are skipped when no user is present.

## Where to go next

| If you want to... | Read |
|---|---|
| Find a quick command sequence for a typical job | [`recipes.md`](recipes.md) |
| Understand the artifacts you've created | [`wiki-output.md`](wiki-output.md) |
| Look up what a `/doc-wiki:*` command does | [`commands.md`](commands.md) |
| Edit `wiki.config.yaml` or `~/.connectors/config.yaml` | [`configuration.md`](configuration.md) |
| Add a new connector or wrap a custom API | [`connectors.md`](connectors.md) |
| Pick the right autonomy mode | [`autonomy-modes.md`](autonomy-modes.md) |
| Diagnose an error | [`troubleshooting.md`](troubleshooting.md) |
| Question not yet answered above | [`faq.md`](faq.md) |
| Contribute to doc-wiki itself | [`../CONTRIBUTING.md`](../CONTRIBUTING.md) |

Or just keep ingesting things and ask questions — that's what the wiki is for.
