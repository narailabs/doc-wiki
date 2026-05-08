# Contributing to doc-wiki

Thanks for your interest. This is a small, opinionated tool — contributions that match the existing patterns and stay surgical are most welcome.

## Prerequisites

- **Node 20.x** — `package.json` caps the runtime at `>=20.0.0 <21.0.0`. Node 21+ is unsupported until upstream deps catch up.
- A working `git` and `npm`.
- For schema-cross-validation work: a database the policy gate accepts (typically dev SQLite).

## Setup

```sh
git clone https://github.com/narailabs/doc-wiki.git
cd doc-wiki
npm install
npm run build
```

## Verifying your change

Run all of these before opening a PR:

```sh
npm run typecheck       # tsc --noEmit
npm test                # vitest run — 886 tests + 5 skipped (live DB) is the baseline
npm run build           # tsc -b tsconfig.build.json (emits .js siblings)
```

If you touched a script under `skills/doc-wiki/scripts/` or an agent under `agents/`, also run the matching focused suite:

```sh
npx vitest run skills/doc-wiki/scripts/tests/
npx vitest run agents/lib/wiki_db/tests/
npx vitest run agents/lib/wiki_orm/tests/
npx vitest run agents/wiki-claude-md-agent/scripts/tests/
npx vitest run agents/wiki-mermaid-agent/scripts/tests/
```

## Where things live

Read [`docs/internals/architecture.md`](docs/internals/architecture.md) for the three-layer model. The short version:

- **Slash commands** live at `commands/doc-wiki:*.md` — thin wrappers that route into the `doc-wiki` skill.
- **The orchestrator skill** lives at `skills/doc-wiki/SKILL.md` — state machine that dispatches scripts and agents.
- **TypeScript scripts** live at `skills/doc-wiki/scripts/` — deterministic operations, compiled to `.js` and invoked via `node`.
- **Agents** live at `agents/` — three of them: `wiki-orm-agent`, `wiki-mermaid-agent`, `wiki-claude-md-agent`.
- **Shared libraries** live at `agents/lib/` — `wiki_db`, `wiki_orm`, plus standalone modules.
- **Reference docs** live at `skills/doc-wiki/references/` — autonomy, code-locality, compilation, operations, quality.

External-source fetching does **not** live in doc-wiki. It is delegated to `narai-primitives`'s `gather()` planner, which dispatches one of the seven bundled connectors. See [`docs/connectors.md`](docs/connectors.md) for the user-facing reference, [`docs/internals/connectors-api.md`](docs/internals/connectors-api.md) for the API.

## Common contributions

| Goal | Where to start |
|---|---|
| Add or modify a `/doc-wiki:*` command | Edit `skills/doc-wiki/SKILL.md` (the command's section) and the wrapper at `commands/wiki-<name>.md` |
| Add a TypeScript script | Add `.ts` under `skills/doc-wiki/scripts/`, add tests under `tests/`, update `docs/internals/architecture.md` script inventory |
| Add an ORM profile | Drop a YAML file under `agents/lib/wiki_orm/profiles/` — `loadProfile()` validates regexes at load time |
| Add a custom local connector | Use the `/create-connector` skill — scaffolds at `.connectors/connectors/<name>/`. **Do not** add it inside doc-wiki sources. |
| Contribute a builtin connector | Open a PR against [narailabs/narai-primitives](https://github.com/narailabs/narai-primitives), not this repo |
| Update documentation | See [`docs/`](docs/) — keep in mind that `CLAUDE.md`, `AGENTS.md`, and `GEMINI.md` are platform wrappers and may need a sync |

## Style and scope

- **Surgical changes only.** Don't refactor adjacent code that isn't broken.
- **No Python.** All scripts are TypeScript; the only `.py` files in the repo are ORM-extractor test fixtures (read as text by the TypeScript tests).
- **Match existing style.** ES modules, TypeScript strict mode, vitest, content-only concept tags.
- **Respect architecture contracts.** See the "Architecture contracts" section of `CLAUDE.md` and `docs/internals/architecture.md` — those invariants are load-bearing.
- **Don't bypass safety.** No `--no-verify`, `git push --force` to main, or skipping the policy gate on the `db` connector.

## Filing an issue or PR

- Bugs and feature requests: https://github.com/narailabs/doc-wiki/issues
- PRs: please include a one-paragraph description and the output of `npm test` + `npm run typecheck`. Reference any related issue.

## License

By contributing, you agree your contributions will be licensed under the [Apache License 2.0](LICENSE).
