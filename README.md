# doc-wiki

> A documentation wiki generator and maintainer that runs entirely as Claude Code skills, agents, and TypeScript helpers. Point it at a codebase, your Jira/Confluence/Notion/GitHub, and your databases — get a structured, queryable, self-healing wiki you can grow over time.

doc-wiki is **a tool you run inside Claude Code** (or Codex / Gemini / Cursor / Aider — see [multi-platform wrappers](#multi-platform-wrappers)). Ten `/doc-wiki:*` slash commands cover the full lifecycle: bootstrap, ingest, query, lint, fix, refresh, and cross-link the wiki as your project evolves. External services are reached through a single planner — [`gather()`](docs/connectors.md#gather) from [`narai-primitives`](https://github.com/narailabs/narai-primitives) — so you configure credentials once and every command can use them.

## What it is good for

- Generating project documentation from a mix of code, README files, design docs, Jira tickets, Confluence pages, GitHub issues, and (read-only) database schemas.
- Maintaining a per-repo knowledge base that survives refactors — content-hash drift detection flags pages whose source code has moved.
- Mapping ORM entities (JPA, SQLAlchemy, Django, Prisma, TypeORM, ActiveRecord, Entity Framework) to live database tables and emitting Mermaid ER diagrams.
- Keeping `CLAUDE.md` (and per-submodule `CLAUDE.md` files) in sync with the wiki.
- Letting you `/doc-wiki:query` instead of `grep`-ing through stale files.

## What it is **not**

- A standalone server or web app. There is no daemon, no UI, no cloud — it lives in your terminal under Claude Code.
- A replacement for code comments or upstream documentation. It complements them.
- A write-back tool for external services. Every connector is **read-only**; the `db` connector ships with a policy gate (`ALLOW` / `DENY` / `ESCALATE` / `PRESENT_ONLY`).

## Install

### From the NarAI marketplace (recommended)

doc-wiki ships as a [Claude Code plugin](https://github.com/narailabs/narai-claude-plugins). One-time marketplace setup, then install:

```sh
claude plugin marketplace add narailabs/narai-claude-plugins
claude plugin install doc-wiki@narai
```

After install, the ten `/doc-wiki:*` slash commands are available in every Claude Code session — no per-project clone, no per-project build.

### Direct from GitHub (no marketplace)

```sh
claude plugin install narailabs/doc-wiki
```

### From source (contributors)

Requires **Node 20.x** (see [`package.json` engines](package.json) — Node 21+ is not yet supported by upstream deps).

```sh
git clone https://github.com/narailabs/doc-wiki.git
cd doc-wiki
npm install
npm run build
```

The TypeScript scripts compile to sibling `.js` files; the plugin layout under [`commands/`](commands/), [`skills/doc-wiki/`](skills/doc-wiki/), and [`agents/`](agents/) is what Claude Code picks up after `claude plugin install --local <path>`.

For full setup including connector access — Jira, GitHub, Confluence, and friends — see [`docs/getting-started.md`](docs/getting-started.md).

## Quickstart

In Claude Code, from the project you want to document:

```text
/doc-wiki:init                  # scaffold wiki/, raw/, graph/, log/, wiki.config.yaml
/doc-wiki:onboard               # detect language, ORM, DB; configure connectors; ask 6 setup questions
/doc-wiki:ingest <source>       # ingest a file, URL, folder, or pasted text — repeat to grow the wiki
```

After three or four `/doc-wiki:ingest` calls you can:

```text
/doc-wiki:query "How does authentication work?"   # summary-first search across the wiki
/doc-wiki:lint                                    # check structural health and auto-heal
/doc-wiki:stats                                   # token efficiency and cost metrics
```

## What's in the box

- **10 slash commands** — `/doc-wiki:init`, `/doc-wiki:onboard`, `/doc-wiki:ingest`, `/doc-wiki:query`, `/doc-wiki:lint`, `/doc-wiki:fix`, `/doc-wiki:promote`, `/doc-wiki:refresh`, `/doc-wiki:path`, `/doc-wiki:stats`. See [`docs/commands.md`](docs/commands.md).
- **3 sub-agents** — `wiki-orm-agent` (entity-to-table mapping), `wiki-mermaid-agent` (deterministic diagram generation), `wiki-claude-md-agent` (`CLAUDE.md` maintenance with managed sections).
- **7 connectors via [`narai-primitives`](https://github.com/narailabs/narai-primitives)** — `db`, `github`, `jira`, `confluence`, `notion`, `aws`, `gcp`. Plus `@narai/credential-providers` for env-var / keychain / file / cloud-secret resolution.
- **5 reference docs** at [`skills/doc-wiki/references/`](skills/doc-wiki/references/) — autonomy, code-locality, compilation, operations, quality.
- **~21 TypeScript helper scripts** — deterministic ops (cache, lint, scoring, graph queries, security, extraction).
- **886 vitest tests** (5 skipped, gated behind `TEST_LIVE_*` env vars).

## Documentation

| Doc | When to read it |
|---|---|
| [`docs/getting-started.md`](docs/getting-started.md) | First time setup — install, onboard, first ingest |
| [`docs/commands.md`](docs/commands.md) | Reference for every `/doc-wiki:*` command (args, examples) |
| [`docs/configuration.md`](docs/configuration.md) | `wiki.config.yaml` and `.connectors/config.yaml` schemas |
| [`docs/architecture.md`](docs/architecture.md) | How doc-wiki is built — three-layer model, ingest pipeline, Mermaid diagrams |
| [`docs/connectors.md`](docs/connectors.md) | The `narai-primitives` stack — `gather()`, the 7 connectors, credentials |
| [`docs/troubleshooting.md`](docs/troubleshooting.md) | Common failures and fixes |
| [`docs/README.md`](docs/README.md) | Audience-routing index for the docs |

For internal Claude Code skill operating manuals (you usually don't need these as a user), see:

- [`CLAUDE.md`](CLAUDE.md) — project-memory architecture overview
- [`skills/doc-wiki/SKILL.md`](skills/doc-wiki/SKILL.md) — orchestrator state machine
- [`skills/doc-wiki/references/`](skills/doc-wiki/references/) — five reference docs

## Multi-platform wrappers

doc-wiki is primarily a Claude Code project, but the same skill is exposed in other AI coding tools via these wrappers:

| File | Tool |
|---|---|
| [`AGENTS.md`](AGENTS.md) | Codex / OpenAI agents |
| [`GEMINI.md`](GEMINI.md) | Gemini / Google AI |
| [`.cursor/rules/doc-wiki.mdc`](.cursor/rules/doc-wiki.mdc) | Cursor IDE |
| [`.aider/conventions.md`](.aider/conventions.md) | Aider |

All four point back to the same scripts and agents under `agents/` and `skills/`.

## Repository layout

```
doc-wiki/
├── README.md, LICENSE, CONTRIBUTING.md       this file + project boilerplate
├── CLAUDE.md, AGENTS.md, GEMINI.md           AI-platform skill manuals
├── docs/                                     public-facing documentation
├── .claude-plugin/plugin.json                Claude Code plugin manifest
├── commands/                                 10 slash-command wrappers (init.md, onboard.md, ...)
├── skills/doc-wiki/
│   ├── SKILL.md                              orchestrator manual
│   ├── scripts/*.ts                          ~21 deterministic helpers
│   └── references/*.md                       5 ref docs (autonomy, quality, ...)
├── agents/                                   3 wiki agents + shared libs (wiki_db, wiki_orm)
├── .connectors/config.example.yaml           starter for ~/.connectors/config.yaml
├── .cursor/rules/doc-wiki.mdc                Cursor wrapper
├── .aider/conventions.md                     Aider wrapper
├── package.json, tsconfig.json               Node + TypeScript setup
└── wiki-workspace/                           archived eval iteration reports
```

## License

doc-wiki is released under the [Apache License 2.0](LICENSE).

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md). PRs welcome; please run `npm test` and `npm run typecheck` before opening one.

## Status

This is a 0.1.x project under active development. Architecture contracts are stable (see [`docs/architecture.md`](docs/architecture.md)) but the surface API may evolve.
