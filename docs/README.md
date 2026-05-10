# doc-wiki documentation

Public-facing documentation for users and operators. Internal Claude Code skill manuals (`SKILL.md`, the per-agent `AGENT.md` files, and the five reference docs under `skills/doc-wiki/references/`) are still authoritative for the orchestrator's behavior — these public docs paraphrase and link into them for human readers.

## Get started

| Doc | When to read |
|---|---|
| [`getting-started.md`](getting-started.md) | Step-by-step tutorial — install through maintenance loop |
| [`recipes.md`](recipes.md) | Common end-to-end command sequences for typical jobs |
| [`wiki-output.md`](wiki-output.md) | What your wiki looks like after first ingest — directory tree, page anatomy, conventions |
| [`faq.md`](faq.md) | Anticipated common questions about setup, privacy, cost, customization |

## Reference

| Doc | When to read |
|---|---|
| [`commands.md`](commands.md) | Every `/doc-wiki:*` command — synopsis, args, examples |
| [`configuration.md`](configuration.md) | `wiki.config.yaml` and `.connectors/config.yaml` schemas, credential-ref grammar |
| [`connectors.md`](connectors.md) | The 7 built-in connectors and the credentials each needs |
| [`atlas.md`](atlas.md) | The eight-phase `/doc-wiki:atlas` walkthrough |
| [`autonomy-modes.md`](autonomy-modes.md) | When to pick conservative / balanced / autonomous / auto |
| [`troubleshooting.md`](troubleshooting.md) | Common failures and how to fix them |

## Advanced

| Doc | When to read |
|---|---|
| [`rest-profiles.md`](rest-profiles.md) | Author a custom REST profile for atlas Phase 1b inventory |

## Contributor reference

For understanding or extending doc-wiki itself, **not** for using it. If you're a user, you don't need these.

| Doc | When to read |
|---|---|
| [`internals/architecture.md`](internals/architecture.md) | Three-layer model, ingest pipeline, script + agent inventory, architecture contracts |
| [`internals/connectors-api.md`](internals/connectors-api.md) | `gather()` API, toolkit helpers, credential-provider internals, contributing a built-in connector |

The dev-loop manual (test commands, where to file PRs) is at the repo root: [`../CONTRIBUTING.md`](../CONTRIBUTING.md).

## Cross-doc concerns

A few topics legitimately span more than one doc. To avoid duplication and drift, each lives in exactly one place:

- **Data flow / `/doc-wiki:ingest` pipeline** — owned by [`internals/architecture.md`](internals/architecture.md) (Mermaid diagram + step-by-step).
- **`gather()` API and `DispatchResult` envelope** — owned by [`internals/connectors-api.md`](internals/connectors-api.md). User-facing connector list + credentials lives in [`connectors.md`](connectors.md).
- **Security baseline** (URL validation, path containment, fetch caps, label sanitization, DB policy gate) — owned by [`internals/architecture.md`](internals/architecture.md). [`connectors.md`](connectors.md) cross-links.
- **YAML schemas and credential-ref grammar** — owned by [`configuration.md`](configuration.md). Other docs link in.
- **Architecture contracts (load-bearing invariants)** — owned by [`internals/architecture.md`](internals/architecture.md). `CLAUDE.md` keeps a copy near the top of the file as a Claude-Code-skill primer; both must stay in sync.

## Internal docs (also useful)

The orchestrator skill and its reference docs live at the plugin root:

- [`../CLAUDE.md`](../CLAUDE.md) — project-memory overview that Claude Code loads automatically.
- [`../skills/doc-wiki/SKILL.md`](../skills/doc-wiki/SKILL.md) — orchestrator state machine.
- [`../skills/doc-wiki/references/`](../skills/doc-wiki/references/) — `autonomy.md`, `code-locality.md`, `compilation.md`, `operations.md`, `quality.md`.
- [`../agents/`](../agents/) — `wiki-orm-agent`, `wiki-mermaid-agent`, `wiki-claude-md-agent` (each has its own `AGENT.md`).

These are referenced from the public docs above where appropriate.
