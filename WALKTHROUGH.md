# Walkthrough: from a new codebase to a working wiki

A run-along tutorial showing the full doc-wiki lifecycle on a brand-new codebase. Plan on ~30 minutes the first time. By the end you will have a queryable wiki with a few pages in it, an archived query you can promote, and a feel for the maintenance loop.

This complements [`docs/getting-started.md`](docs/getting-started.md), which is the concise reference version. If you already know what you are doing, read that instead. If this is your first time, follow along here — every section shows the exact command to type, what you should see, and where to look up more.

> **Conventions in this doc.** Lines starting with `$` are shell commands; lines starting with `/` are slash commands you type into Claude Code (or Codex / Gemini / Cursor / Aider). Output blocks are illustrative — yours will differ in details.

## 0. Prerequisites

You need:

- **Node 20.x.** Run `node --version` to check. Node 21+ is not yet supported — some upstream dependencies (`better-sqlite3`, `pdfjs-dist`) have not shipped Node-21 binaries. Use `nvm install 20` if needed.
- **Claude Code** (the canonical host) or one of Codex / Gemini / Cursor / Aider. doc-wiki ships wrappers for each — see the [multi-platform wrappers](README.md#multi-platform-wrappers) section of the README.
- **Optional:** credentials for any external services you want to ingest from (Jira, Confluence, GitHub, Notion, AWS, GCP, or a database). You can skip these now and add them later via `/doc-wiki:onboard` — most of the walkthrough works with local files only.

## 1. Install doc-wiki

The recommended path is the [NarAI marketplace](https://github.com/narailabs/narai-claude-plugins). One-time setup, then the slash commands appear in every Claude Code session:

```sh
$ claude plugin marketplace add narailabs/narai-claude-plugins
$ claude plugin install doc-wiki@narai
```

If you would rather skip the marketplace, install directly from GitHub:

```sh
$ claude plugin install narailabs/doc-wiki
```

Either way, the nine `/doc-wiki:*` commands are now available. Confirm by typing `/` in a Claude Code session — you should see `doc-wiki:init`, `doc-wiki:onboard`, `doc-wiki:ingest`, and friends in the autocomplete.

> **Building from source instead?** Follow [`docs/getting-started.md` § Install and build](docs/getting-started.md#install-and-build). You only need this if you are contributing to doc-wiki itself.

## 2. Open YOUR codebase

The slash commands run in **whatever project Claude Code currently has open** — they do not need to live next to the doc-wiki source. Open the repository you want to document. The wiki will be scaffolded inside it, in a `wiki/` directory.

For the rest of this walkthrough I will assume you are documenting an auth service with a `package.json`, a `README.md`, a `src/` directory, and a Postgres database. Your specifics will differ; adapt the commands accordingly.

## 3. `/doc-wiki:init` — scaffold the wiki

```text
/doc-wiki:init
```

That is the whole command. Optional flags:

| Flag | Default | Purpose |
|---|---|---|
| `--path <wiki-root>` | `wiki/` | Where to put the wiki |
| `--domain "<domain>"` | `general` | Broad topic, e.g. `backend-services` |
| `--name "<wiki-name>"` | (project name) | Appears in `wiki.config.yaml` and `wiki/overview.md` |

After it runs, your repo gains a directory layout like this (block reused from [`docs/getting-started.md`](docs/getting-started.md#doc-wikiinit--bootstrap-a-wiki)):

```
wiki/
├── wiki.config.yaml          # config (you'll edit this in the next step)
├── wiki/
│   ├── index.md              # master catalog (empty)
│   ├── summaries.md          # enriched summary index (empty)
│   └── overview.md           # evolving big-picture synthesis
├── raw/                      # raw fetched sources (cached)
├── graph/
│   └── edges.jsonl           # typed relationships between pages
├── audit/                    # audit logs from policy-gated ops
├── log/
│   └── events.jsonl          # operation event stream
├── outputs/
│   └── queries/              # archived /doc-wiki:query answers
├── .wiki-cache/              # content-hash dedup cache
└── .wiki-ignore              # gitignore-style filter for ingestion
```

`/doc-wiki:init` is **idempotent** — re-running it never overwrites existing files. If you already have a `wiki/` from a previous run, it just creates whatever is missing.

**Look up more:** [`docs/commands.md` § /doc-wiki:init](docs/commands.md#doc-wikiinit--bootstrap-a-wiki).

## 4. `/doc-wiki:onboard` — interactive setup

This is the section where doc-wiki learns what it is documenting. It is interactive — six phases of detection and Q&A. Run:

```text
/doc-wiki:onboard
```

Exact wording may vary slightly with the skill version; below is what to expect.

### Phase 1 — language and framework

doc-wiki scans for marker files (`pom.xml`, `package.json`, `requirements.txt`, `go.mod`, `Cargo.toml`, `Gemfile`, `*.csproj`, `*.sln`) and reports what it found:

> Example output (yours will differ):
> ```
> Detected language: TypeScript / Node.js (from package.json)
> Confirm? [Y/n]
> ```

Press Enter to accept, or type the correct stack.

### Phase 2 — ORM detection

doc-wiki dispatches the `wiki-orm-agent` to scan for entity definitions across the seven supported profiles: JPA, SQLAlchemy, Django, Prisma, TypeORM, Entity Framework, ActiveRecord.

> ```
> Detected ORM: Prisma (3 models in prisma/schema.prisma)
> Models: User, Session, RefreshToken
> Confirm? [Y/n]
> ```

If you have no ORM, say no — the rest of the flow still works.

### Phase 3 — database

doc-wiki reads `docker-compose.yml`, `.env`, ORM config, and connection strings, redacting credentials before showing you what it found:

> ```
> Detected database: postgres at localhost:5432/auth_dev (from docker-compose.yml)
> Credentials redacted. Confirm? [Y/n]
> ```

### Phase 4 — six external-service questions

These determine which connectors are enabled in the next phase:

> ```
> Do you use Jira for issue tracking? If so, what project key(s)?
> Do you use Confluence for documentation? If so, what space key(s)?
> Do you use GCP (BigQuery, Cloud SQL, Pub/Sub)? Which services?
> Do you use AWS (RDS, DynamoDB, S3)? Which services?
> Do you use Notion for documentation or knowledge base?
> Do you use GitHub wikis, discussions, or project boards?
> ```

Answer each. Bare `no` is fine for any service you are not using.

### Phase 4b — connector access

For every "yes" you gave, doc-wiki asks one credential question and writes a starter `~/.connectors/config.yaml`:

> ```
> Where does your Jira/Confluence API token live?
> (env var name, keychain label, or file path)
> ```

You can answer in one of four forms:

| Form | Means |
|---|---|
| `env:JIRA_API_TOKEN` | Read from environment variable |
| `keychain:jira-pat` | Read from OS keychain entry (macOS Keychain or libsecret) |
| `file:~/.secrets/jira` | Read from a file (with permission check) |
| `cloud:aws-secret/<arn>` | Read from AWS Secrets Manager (or `cloud:gcp-secret/...`) |

Credential resolution is **lazy**: `narai-primitives` only fetches the secret when a connector actually runs, and only inside the connector's subprocess. doc-wiki itself never sees the cleartext value.

### Phase 5 — autonomy mode

Pick one:

| Mode | Behavior |
|---|---|
| `conservative` | Ask before every write |
| `balanced` (default) | Auto-fix safe changes, ask for structural changes |
| `autonomous` | Auto-fix everything, notify after |
| `auto` | Choose per-operation based on a risk score |

For your first wiki, stick with `balanced`. You can change it later by editing `wiki/wiki.config.yaml`. Full rules live in [`skills/doc-wiki/references/autonomy.md`](skills/doc-wiki/references/autonomy.md).

### Phase 6 — hooks and multimodal deps

doc-wiki offers to install platform hooks (skip if unsure), then asks about optional multimodal dependencies:

> ```
> Your wiki may ingest audio/video files (.mp4, .mp3, .wav, ...) or YouTube URLs later.
> Extraction uses two optional tools that aren't installed by default:
>  - faster-whisper for local audio transcription (~100 MB model on first use)
>  - yt-dlp for downloading YouTube audio (single binary)
>
> Shall I help you set these up? [Yes both / yt-dlp only / Skip / Never ask]
> ```

`Skip` is fine if you are only ingesting code and text. doc-wiki will warn-and-skip multimodal sources until you install the tools.

By the time onboard finishes, you have a fully populated `wiki/wiki.config.yaml` and (if any external services were enabled) a `~/.connectors/config.yaml`. **Onboard is idempotent** — re-run any time the project changes.

**Look up more:** [`docs/commands.md` § /doc-wiki:onboard](docs/commands.md#doc-wikionboard--interactive-onboarding), [`docs/configuration.md`](docs/configuration.md), [`docs/connectors.md`](docs/connectors.md).

## 5. `/doc-wiki:ingest` — your first source

Pick something small. Your `README.md` is the natural starting point:

```text
/doc-wiki:ingest README.md
```

Under the hood this kicks off a 13-step pipeline (full diagram in [`docs/architecture.md`](docs/architecture.md#diagram-2-wiki-ingest-pipeline)). The user-visible result: a new compiled page appears under `wiki/`, `wiki/index.md` gains a bullet, and `wiki/summaries.md` gains a one-paragraph summary.

The compiled page has frontmatter, narrative content, Mermaid diagrams (where relevant), and a "How to Go Deeper" section pointing back to the original source. Here is a real excerpt from a generated page so you know what to expect:

~~~markdown
---
title: Authentication and Session Management
type: concept
tags: [authentication, jwt, session-management, refresh-token, rs256, postgresql]
sources: [raw/auth/architecture.md]
created: 2026-04-14
updated: 2026-04-14
quality: 0.0
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
~~~

(Source: [`wiki-workspace/iteration-2/wiki-init-ingest-query/with_skill/outputs/wiki/auth/authentication.md`](wiki-workspace/iteration-2/wiki-init-ingest-query/with_skill/outputs/wiki/auth/authentication.md).)

`/doc-wiki:ingest` accepts files, folders, URLs, and pasted text. A few examples:

```text
/doc-wiki:ingest src/auth/                                       # ingest every file in a folder
/doc-wiki:ingest https://your-org.atlassian.net/browse/AUTH-123  # only works if Jira is enabled
/doc-wiki:ingest https://github.com/narailabs/doc-wiki           # GitHub repo
/doc-wiki:ingest /path/to/design-spec.pdf                        # binary extraction
```

Two behaviors worth knowing:

- **Caching.** doc-wiki SHA256-hashes every source and skips re-ingesting unchanged content. Re-running `/doc-wiki:ingest README.md` immediately after the first call is a no-op.
- **Folder checkpointing.** `/doc-wiki:ingest src/` runs the pipeline once per file and writes a checkpoint after each. If you interrupt it (Ctrl+C, lost connection), re-running the same command picks up where it stopped.

**Look up more:** [`docs/commands.md` § /doc-wiki:ingest](docs/commands.md#doc-wikiingest--fetch-extract-compile), [`docs/architecture.md`](docs/architecture.md#diagram-2-wiki-ingest-pipeline), [`docs/connectors.md`](docs/connectors.md).

## 6. Ingest a few more sources

A wiki with one page is not a wiki. Run `/doc-wiki:ingest` two or three more times across different kinds of sources to seed coverage. Good first ingests:

- A core source folder: `/doc-wiki:ingest src/auth/`
- A design doc: `/doc-wiki:ingest docs/auth-design.md`
- A linked Jira ticket (if enabled in onboard): `/doc-wiki:ingest https://your-org.atlassian.net/browse/AUTH-123`

After three or four pages exist, the post-operation hooks (crosslink and tag-harmonize) start adding inline links and concept tags across pages — that is what gives the wiki its graph structure.

### Bulk shortcut — `/doc-wiki:atlas`

If running `/doc-wiki:ingest` five or ten times by hand feels tedious, `/doc-wiki:atlas` does the whole sweep in one phased pass:

```text
/doc-wiki:atlas --dry-run    # see the plan + cost estimate, no writes
/doc-wiki:atlas              # for real
```

Atlas auto-discovers topics (top-level code dirs, ORM domains, existing wiki dirs, gitlog churn), confirms with you, then fires `/doc-wiki:ingest` per `(topic × facet)` pair (architecture, data-model, environments, api, operations) and synthesizes three global aggregation pages (`wiki/overview.md`, `wiki/integrations.md`, `wiki/deploy.md`).

A few flags worth knowing:

- `--facets architecture,data-model` — generate only those facets per topic (default is the comprehensive set). **Re-runs are additive** — narrowing the facet set on a re-run never deletes pages from a prior wider run.
- `--scope auth` — restrict to one topic for incremental work.
- `--max-cost <usd>` — default `200`; aborts pre-write if the estimate exceeds.
- `--validate-mode shallow|full` — when re-running on an existing wiki, atlas does a structural lint + gitlog-driven drift scan + semantic LLM check on each existing atlas page. `shallow` (default) samples; `full` checks every page (cached on `(page-hash, source-hash)` so unchanged pairs cost zero).

Use `/doc-wiki:atlas` when you want a comprehensive bootstrap (or a periodic audit on an existing wiki); use `/doc-wiki:ingest` for incremental day-to-day growth.

**Look up more:** [`docs/commands.md` § /doc-wiki:atlas](docs/commands.md#doc-wikiatlas--full-application-documentation), [`docs/architecture.md` § Diagram 4](docs/architecture.md#diagram-4-doc-wikiatlas-pipeline).

## 7. `/doc-wiki:query` — ask a question

The wiki is now queryable. Try:

```text
/doc-wiki:query "How does authentication work in this repo?"
```

The flow:

1. doc-wiki reads `wiki/summaries.md` (one ~50-token summary per page).
2. Scores every summary against your question.
3. Loads the top-N matching pages in full.
4. Follows their inline links up to `--max-depth` hops (default 3).
5. Synthesizes an answer with inline citations.
6. Surfaces gaps — questions the wiki cannot answer.
7. Archives the full transcript to `wiki/outputs/queries/<timestamp>.md`.

The answer comes back inline in your Claude Code session, with markdown citations to the wiki pages it drew from. You can keep asking follow-up questions; each gets archived for later promotion.

**Path mode** (shortest connection between two concepts) uses the typed-edge graph instead of summaries:

```text
/doc-wiki:query --from auth --to billing --via session --max-hops 4
```

Useful for "how do these two parts of the system relate?" questions.

**Look up more:** [`docs/commands.md` § /doc-wiki:query](docs/commands.md#doc-wikiquery--summary-first-search-synthesis-and-shortest-path).

## 8. `/doc-wiki:promote` — keep a good answer

Some queries produce answers worth keeping permanently. After a query you like, promote it:

```text
/doc-wiki:promote last query
```

doc-wiki resolves `last query` to the most-recent archive in `wiki/outputs/queries/`, compiles it into a permanent wiki page, places it under `wiki/<topic>/<slug>.md`, updates indexes, and moves the archive to `outputs/queries/.promoted/` (so you do not see it again next time you triage).

Other target forms work too:

```text
/doc-wiki:promote last query --topic auth                     # force the topic directory
/doc-wiki:promote 2                                           # second-most-recent archive
/doc-wiki:promote outputs/queries/2026-04-28T10-15.md         # explicit path
```

This is the **feedback loop** worth internalizing: **query exposes what is missing → promote fills the gap → the next query is faster**. Wikis grow by use, not by upfront planning.

**Bulk triage** when archives have piled up:

```text
/doc-wiki:promote --review --since 7d
```

Walks every archive from the last week and asks, per archive: `[P]romote / [S]kip / [D]elete / [A]bort`. Already-covered insights are auto-skipped under `balanced` autonomy.

**Look up more:** [`docs/commands.md` § /doc-wiki:promote](docs/commands.md#doc-wikipromote--query-answer-to-permanent-page).

## 9. `/doc-wiki:refresh` — keep sources current

Upstream sources change. A Jira ticket gets updated, a README is rewritten, a schema migrates. To re-fetch and re-compile changed pages:

```text
/doc-wiki:refresh --all
```

Either `--source <one-source>` or `--all` is required. doc-wiki reads `log/events.jsonl` to find every source it has ever ingested, re-fetches them through the same connectors, and re-compiles only the pages whose content hash changed.

A typical cadence is weekly. Pair it with the `/schedule` skill (when available in your environment) to run unattended:

```text
/schedule "Run /doc-wiki:refresh --all" "every Monday at 9am"
```

**Look up more:** [`docs/commands.md` § /doc-wiki:refresh](docs/commands.md#doc-wikirefresh--re-fetch-and-update).

## 10. `/doc-wiki:lint` and `/doc-wiki:fix` — health checks

Run lint after a batch of ingests to catch structural problems:

```text
/doc-wiki:lint
```

Checks include broken links, missing frontmatter, orphan pages, code-ref drift (a wiki page references code whose content hash has changed), provenance gaps, and stale pages (>90 days since last update). The output is a categorized report.

To auto-heal the safe categories under your configured autonomy mode:

```text
/doc-wiki:lint --fix
```

For a targeted fix on one page:

```text
/doc-wiki:fix wiki/auth/authentication.md "frontmatter is missing the security tag"
```

doc-wiki reads the page, drafts a fix matching the description, shows you a diff, and applies it on confirmation (or auto-applies in `autonomous` / `auto` modes).

**Look up more:** [`docs/commands.md` § /doc-wiki:lint](docs/commands.md#doc-wikilint--health-check-and-auto-heal), [`docs/commands.md` § /doc-wiki:fix](docs/commands.md#doc-wikifix--quick-targeted-correction).

## 11. `/doc-wiki:stats` — see what you have spent

Token usage and cost are tracked in `log/events.jsonl`. Aggregate them:

```text
/doc-wiki:stats --since 7d --per-agent
```

You will see total tokens in/out, p50/p95 reduction ratios (tokens read versus tokens kept in the answer — your wiki is doing its job if this is high), per-operation costs, and a per-agent breakdown including the connector calls that ran inside `gather()`.

Useful for a "is the cache hitting?" or "is one connector dominating cost?" sanity check.

**Look up more:** [`docs/commands.md` § /doc-wiki:stats](docs/commands.md#doc-wikistats--token-efficiency-and-cost-metrics).

## 12. The maintenance loop

Once you have a working wiki, the steady-state cadence looks like:

```text
# whenever new code/docs land
/doc-wiki:ingest <new-source>

# whenever you have a question
/doc-wiki:query "<question>"

# weekly (cron-friendly via /schedule)
/doc-wiki:refresh --all
/doc-wiki:lint --fix
/doc-wiki:promote --review --since 7d
/doc-wiki:stats --since 7d
```

That is the whole loop. Your wiki gets richer the more you use it: each query exposes a coverage gap, each promote fills one, each refresh keeps it from going stale, each lint catches drift before it compounds.

## Where to go next

| If you want to... | Read |
|---|---|
| Look up what a `/doc-wiki:*` command does | [`docs/commands.md`](docs/commands.md) |
| Edit `wiki.config.yaml` or `~/.connectors/config.yaml` | [`docs/configuration.md`](docs/configuration.md) |
| Understand the ingest pipeline internals | [`docs/architecture.md`](docs/architecture.md) |
| Add a new connector or wrap a custom API | [`docs/connectors.md`](docs/connectors.md) |
| Diagnose an error | [`docs/troubleshooting.md`](docs/troubleshooting.md) |
| Contribute to doc-wiki itself | [`CONTRIBUTING.md`](CONTRIBUTING.md) |

Or just keep ingesting things and ask questions — that is what the wiki is for.
