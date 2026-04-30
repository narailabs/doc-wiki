# doc-wiki documentation

This directory holds the public-facing documentation for doc-wiki. The internal Claude Code skill manuals (`SKILL.md`, the per-agent `AGENT.md` files, and the five `references/*.md` files under `skills/doc-wiki/references/`) are still authoritative for the orchestrator's behavior — these docs paraphrase and link into them for human readers.

## Where to start

| You want to... | Read |
|---|---|
| Install doc-wiki and run your first command | [`getting-started.md`](getting-started.md) |
| Look up what a `/doc-wiki:*` command does | [`commands.md`](commands.md) |
| Configure `wiki.config.yaml` or connector access | [`configuration.md`](configuration.md) |
| Understand how doc-wiki is built | [`architecture.md`](architecture.md) |
| Understand how doc-wiki talks to external services | [`connectors.md`](connectors.md) |
| Diagnose a failure | [`troubleshooting.md`](troubleshooting.md) |

## Documents

| Doc | Audience | One-line summary |
|---|---|---|
| [`getting-started.md`](getting-started.md) | New users | Prereqs, install, `/doc-wiki:init`, `/doc-wiki:onboard`, first `/doc-wiki:ingest`, verifying it worked |
| [`commands.md`](commands.md) | Operators | All 10 `/doc-wiki:*` commands with synopsis, args, examples, and links to the orchestrator skill |
| [`configuration.md`](configuration.md) | Operators / contributors | Schema reference for `wiki.config.yaml` and `.connectors/config.yaml`, plus credential-ref grammar |
| [`architecture.md`](architecture.md) | Contributors / integrators | Three-layer model, ingest pipeline, scripts/agents/libraries inventory, Mermaid diagrams, architecture contracts |
| [`connectors.md`](connectors.md) | Contributors / integrators | The `narai-primitives` stack — hub, toolkit, config, 7 connectors, `@narai/credential-providers` |
| [`troubleshooting.md`](troubleshooting.md) | Anyone hitting an error | Common failures and how to fix them |

## Cross-doc concerns

A few topics legitimately span more than one doc. To avoid duplication and drift, each lives in exactly one place:

- **Data flow / `/doc-wiki:ingest` pipeline** — owned by [`architecture.md`](architecture.md) (Mermaid diagram + step-by-step).
- **`gather()` flow and `DispatchResult` envelope** — owned by [`connectors.md`](connectors.md). `architecture.md` shows how doc-wiki *uses* `gather()`; `connectors.md` is the API reference.
- **Security baseline** (URL validation, path containment, fetch caps, label sanitization, DB policy gate) — owned by [`architecture.md`](architecture.md). `connectors.md` cross-links.
- **YAML schemas** — owned by [`configuration.md`](configuration.md). Other docs link in.
- **`narai-primitives` consolidation history** — owned by [`connectors.md`](connectors.md). Don't restate.
- **Architecture contracts (load-bearing invariants)** — owned by [`architecture.md`](architecture.md). `CLAUDE.md` keeps a copy near the top of the file as a Claude-Code-skill primer; both must stay in sync.

## Internal docs (also useful)

The orchestrator skill and reference docs live at the plugin root:

- [`../CLAUDE.md`](../CLAUDE.md) — project-memory overview that Claude Code loads automatically
- [`../skills/doc-wiki/SKILL.md`](../skills/doc-wiki/SKILL.md) — orchestrator state machine
- [`../skills/doc-wiki/references/`](../skills/doc-wiki/references/) — `autonomy.md`, `code-locality.md`, `compilation.md`, `operations.md`, `quality.md`
- [`../agents/`](../agents/) — `wiki-orm-agent`, `wiki-mermaid-agent`, `wiki-claude-md-agent` (each has its own `AGENT.md`)

These are referenced from the public docs above where appropriate.
