# Getting Started

This walkthrough takes you from zero to a working wiki — install, onboard, first ingest, and verification — in roughly fifteen minutes.

## Prerequisites

- **Node.js 20.x.** The repo's [`package.json`](../package.json) pins `engines.node` to `>=20.0.0 <21.0.0`. Node 21+ is unsupported because some upstream dependencies (notably `better-sqlite3` and `pdfjs-dist`) have not yet shipped Node-21 binaries. If `node --version` reports anything else, install Node 20 first (e.g. via `nvm install 20`).
- **`git` and `npm`** (a recent version of either npm 10.x or pnpm 9.x is fine).
- **Claude Code, Codex, Gemini, Cursor, or Aider** to invoke the slash commands. doc-wiki ships wrappers for each — see [Multi-platform wrappers](../README.md#multi-platform-wrappers).
- Optional: credentials for any external services you want doc-wiki to read from (Jira, Confluence, GitHub, Notion, AWS, GCP, or a database). You can add these later via `/doc-wiki:onboard`.

## Install and build

Clone the repo and build once:

```sh
git clone https://github.com/narailabs/doc-wiki.git
cd doc-wiki
npm install
npm run build
```

`npm install` pulls down the `narai-primitives` package (which bundles the connector hub, toolkit, config loader, and seven connectors) and `@narai/credential-providers` (kept as a separate package). `npm run build` invokes `tsc -b tsconfig.build.json`, which emits `.js` siblings next to every `.ts` file under `skills/doc-wiki/scripts/` and `agents/lib/`. The TypeScript scripts are then ready to be invoked via `node`.

Verify the build worked:

```sh
node skills/doc-wiki/scripts/parse_config.js --help 2>&1 | head
npm test
```

The first command should print usage info (it loads cleanly). The second command should report **934 tests passed, 5 skipped** (the skipped ones are live-database integration tests gated behind `TEST_LIVE_*` env vars — see [troubleshooting.md](troubleshooting.md) for how to enable them).

## Configure connector access (one-time)

Most workflows ingest from external sources eventually — Jira tickets, GitHub issues, Confluence pages, your database. Configuration for those lives in `~/.connectors/config.yaml` (user-global) and/or `./.connectors/config.yaml` (per-repo overlay). Both files use the same schema and are read by [`narai-primitives`](connectors.md)'s config loader.

`/doc-wiki:onboard` (next section) walks you through creating this file the first time. If you want to do it manually now, copy the example:

```sh
mkdir -p ~/.connectors
cp .connectors/config.example.yaml ~/.connectors/config.yaml
$EDITOR ~/.connectors/config.yaml
```

Uncomment the connectors you want, and provide credential refs in one of these forms:

| Form | Means |
|---|---|
| `env:GITHUB_TOKEN` | Read from environment variable `GITHUB_TOKEN` |
| `keychain:github-pat` | Read from OS keychain entry labeled `github-pat` (macOS Keychain or libsecret on Linux) |
| `file:~/.secrets/github` | Read from a file (with permission check) |
| `cloud:aws-secret/<arn>` | Read from AWS Secrets Manager |
| `cloud:gcp-secret/<resource>` | Read from GCP Secret Manager |

Credential resolution is lazy: `narai-primitives` only fetches the secret when a connector is actually invoked, and only inside the connector's subprocess. Doc-wiki itself never sees the cleartext value. See [`docs/configuration.md`](configuration.md) for the full schema.

## `/doc-wiki:init` — bootstrap a wiki

Open the project you want to document in Claude Code (or one of the other supported tools) and run:

```text
/doc-wiki:init
```

Optional flags: `--path <wiki-root>` (default `wiki/`), `--domain "<domain>"`, `--name "<wiki-name>"`.

This invokes `init_wiki.ts` and creates a directory layout:

```
<wiki-root>/
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
│   └── queries/              # archived `/doc-wiki:query` answers
├── .wiki-cache/              # content-hash dedup cache
└── .wiki-ignore              # gitignore-style filter for ingestion
```

You can re-run `/doc-wiki:init` if you want to rescaffold; existing files are never overwritten.

## `/doc-wiki:onboard` — interactive setup

Now run:

```text
/doc-wiki:onboard
```

This is a six-phase interactive flow driven by the orchestrator skill. It will:

1. **Detect language and framework** — by reading `pom.xml`, `package.json`, `requirements.txt`, `go.mod`, `Cargo.toml`, `Gemfile`, etc.
2. **Detect ORM** — by dispatching the `wiki-orm-agent`, which scans for entity definitions matching the seven shipped profiles (JPA, SQLAlchemy, Django, Prisma, TypeORM, Entity Framework, ActiveRecord).
3. **Detect databases** — by reading `docker-compose.yml`, ORM config, `.env`, `application.properties`, and similar; redacted credentials shown for confirmation.
4. **Ask about external services** — six yes/no questions covering Jira, Confluence, GCP, AWS, Notion, and GitHub. Your answers populate `consumers.doc-wiki` in the connector config.
5. **Set up connector access** — checks for `~/.connectors/config.yaml` and `./.connectors/config.yaml`. If neither exists, generates a starter from `.connectors/config.example.yaml` and asks one credential question per enabled service.
6. **Pick autonomy mode** — `conservative` / `balanced` / `autonomous` / `auto`. See [`skills/doc-wiki/references/autonomy.md`](../skills/doc-wiki/references/autonomy.md). Most users start at `balanced`.

Onboarding writes everything to `wiki.config.yaml` (in the wiki root) and the connector config files. You can re-run it any time — it's idempotent.

## `/doc-wiki:ingest` — first source

Pick something small to start with, like a `README.md` or a design doc:

```text
/doc-wiki:ingest path/to/README.md
```

Or a URL:

```text
/doc-wiki:ingest https://your-org.atlassian.net/browse/AUTH-123
```

Or an entire directory (this runs the 13-step pipeline once per file, with a checkpoint so you can resume):

```text
/doc-wiki:ingest src/
```

Behind the scenes, `/doc-wiki:ingest` runs (see [`docs/architecture.md`](architecture.md#diagram-2-wiki-ingest-pipeline) for the full pipeline):

1. Parse `wiki.config.yaml` to find the wiki root.
2. Check the SHA256 cache to skip already-ingested content.
3. Run a security check (URL validation, path containment).
4. Extract the source (binary file? text? HTML? archive? multimodal?).
5. Read the source completely.
6. Surface 3–5 takeaways and an entity list.
7. Call [`gather()`](connectors.md#gather) from `narai-primitives` to fetch related context from any enabled connectors (e.g., linked Jira tickets, related GitHub issues, schema for entities mentioned in the source).
8. Compile the wiki page(s) — proper frontmatter, claims metadata, code references with content hashes.
9. Augment with Mermaid diagrams (via [`mermaid_augment.ts`](../agents/lib/mermaid_augment.ts)).
10. Generate "How to Go Deeper" hints — one bullet per source class.
11. Update `wiki/index.md` and `wiki/summaries.md`.
12. Log the operation to `log/events.jsonl`.
13. Run post-op hooks (crosslink + tag-harmonize, if 3+ pages exist).

By the time the command returns, the new page is linked, summarized, indexed, and ready for `/doc-wiki:query`.

## Verifying it worked

After ingesting two or three sources:

```text
/doc-wiki:stats
```

This reports token efficiency, per-agent costs, and ingest counts from `log/events.jsonl`. Useful sanity check that the cache is being hit and connector calls are succeeding.

```text
/doc-wiki:lint
```

Runs structural checks (broken links, missing frontmatter, orphans, isolated nodes, code-ref drift, provenance gaps, Mermaid syntax errors) and prints a report. Add `--fix` to auto-heal what's safe to fix automatically.

```text
/doc-wiki:query "What does the auth module do?"
```

Reads `wiki/summaries.md`, scores the question against each summary, loads the top-N pages, follows their inline links, and synthesizes an answer. The full transcript is archived under `outputs/queries/` so you can `/doc-wiki:promote` it into a permanent page later if it proves valuable.

## Where to go next

- **Looking up a command?** → [`commands.md`](commands.md) — every `/doc-wiki:*` with args and examples.
- **Configuring something?** → [`configuration.md`](configuration.md) — `wiki.config.yaml` and `.connectors/config.yaml` schemas.
- **Wondering how it works?** → [`architecture.md`](architecture.md) — the three-layer model and ingest pipeline.
- **Adding a connector?** → [`connectors.md`](connectors.md) — the `narai-primitives` stack and how to add a custom local connector.
- **Hitting an error?** → [`troubleshooting.md`](troubleshooting.md).
