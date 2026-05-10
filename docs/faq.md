# FAQ

Anticipated questions when installing, configuring, or evaluating doc-wiki. For specific failures (errors, missing tools, weird outputs), check [`troubleshooting.md`](troubleshooting.md) first.

## Setup and basics

### Where does my wiki live? Can I move it later?

By default, `/doc-wiki:init` puts the wiki at `docs/<app-name>-wiki/` (the kebab-cased project name from `package.json` / `pyproject.toml` / `go.mod` / etc.). You can override at scaffold time:

```text
/doc-wiki:init --path /custom/path/to/wiki
```

To move an existing wiki, just `mv` the directory and update any `--wiki-root` flags or `wiki.config.yaml` references that mention the old path. The `.wiki-cache/` survives the move; ingestion picks up where it left off.

The naming pattern (`docs/<app-name>-wiki/`) is chosen so opening the folder as an Obsidian vault gives it the project's name rather than a generic `wiki` label. See [`commands.md` § /doc-wiki:init](commands.md#doc-wikiinit--bootstrap-a-wiki).

### Can I edit pages by hand? Will my edits survive?

Yes — the wiki is plain markdown with YAML frontmatter. Edit anything you want. **What survives** auto-regeneration: narrative prose outside marker regions, custom sections you add, hand-curated index entries, mostly-everything outside the `<!-- wiki-mermaid: ... -->` and `<!-- wiki-managed: ... -->` markers.

**What gets overwritten** on `refresh` / `lint --fix` / next `/doc-wiki:ingest` of the same source: content inside the markers, auto-derived frontmatter fields when the source has changed.

For diff-reviewed targeted edits, use `/doc-wiki:fix <page-path> "<issue description>"`. See [`wiki-output.md` § Editing pages by hand](wiki-output.md#editing-pages-by-hand).

### Does it work without external connectors?

Yes. Every connector in `~/.connectors/config.yaml` is opt-in — the file even ships with all seven connector blocks commented out. If you only ingest local files (`/doc-wiki:ingest README.md`, `/doc-wiki:ingest src/`), no external services are touched.

To skip the connector questions during onboarding, answer "no" to all six external-service prompts in `/doc-wiki:onboard` Phase 4. You can always add connectors later — see [recipe 5](recipes.md#5-add-a-new-external-service-mid-stream).

### Can I use this for non-code documentation?

Yes. `/doc-wiki:ingest` works on any text, markdown, PDF, or URL — the underlying compilation step doesn't care whether it's source code or research notes. The ORM / database / REST detection in `/doc-wiki:onboard` is **optional** (you can skip it), so a research-project or product-docs wiki works fine.

The atlas pipeline is biased toward codebases (its topic discovery uses code-dir heuristics), but `/doc-wiki:ingest` itself is content-agnostic.

## Privacy and security

### Does my code or credentials leave my machine?

**Code:** Only the slice the LLM needs for synthesis (during `/ingest` compilation, `/query` answering, atlas synthesis). doc-wiki sends source content to Claude as part of the orchestration prompt — same surface area as any Claude Code session that reads files.

**Credentials:** Never. They're resolved **inside the connector subprocess** via `narai-primitives/credentials`. doc-wiki passes the config slice with credential **refs** (`env:GITHUB_TOKEN`, etc.) — never resolved values. Even if you log `gather()` results, you'll see API responses, not tokens.

This is invariant #4 in the [architecture contracts](internals/architecture.md#architecture-contracts).

### What if my repo is private?

Works fine. doc-wiki never publishes anywhere — all output is local files under your wiki root. Connectors are read-only-from-your-side: they fetch from external services, they don't write to them. See [`connectors.md`](connectors.md) for the read-only contract per connector.

### How do I uninstall?

```sh
$ claude plugin uninstall doc-wiki@narai
```

That removes the plugin (commands and skill). Your wiki content is on disk under `<wiki-root>/` — keep, archive, or delete as you wish. Connector config at `~/.connectors/config.yaml` is also yours to keep — it may be used by other tools (e.g. a separate analytics CLI).

## Cost and performance

### How much does it cost to run?

Order of magnitude: an `/doc-wiki:ingest` of a 200-line README runs $0.01–$0.05. An `/doc-wiki:atlas` of a mid-sized repo (100 source files) runs $1–$5. A `/doc-wiki:query` runs $0.005–$0.02 (cheap because summaries-first scoring loads only the top-N pages, not the whole wiki).

To inspect actuals: `/doc-wiki:stats --since 7d --per-agent`. To preview before writing: `/doc-wiki:atlas --dry-run`. To cap aggressively: `/doc-wiki:atlas --max-cost 50`.

See [`atlas.md` § Cost and cap](atlas.md#cost-and-cap).

### Why are query results sometimes vague?

Likely the wiki is too sparse. `/doc-wiki:query` scores against `wiki/summaries.md` first; if you only have one or two pages, there's not enough signal. Run a few more `/doc-wiki:ingest` (or one `/doc-wiki:atlas`) to seed coverage. See [`troubleshooting.md` § /doc-wiki:query returns nothing useful](troubleshooting.md#doc-wikiquery-returns-nothing-useful).

## Collaboration

### Can multiple people share a wiki?

Yes. Commit `wiki.config.yaml` and the entire `wiki/` tree to git (and `graph/edges.jsonl` if you want crosslink state shared). Gitignore `.wiki-cache/`, `.wiki-checkpoint.json`, `log/events.jsonl`, and typically `outputs/queries/` (transcript history is per-user).

Connector credentials stay user-local in `~/.connectors/config.yaml` — not committed. Each teammate runs their own onboard / supplies their own tokens. See [`wiki-output.md` § Wiki directory tree](wiki-output.md#the-wiki-directory-tree) for the gitignore pattern.

### Can I use Cursor / Aider / Codex / Gemini instead of Claude Code?

Yes. doc-wiki ships wrappers for each tool:

- `AGENTS.md` — Codex / OpenAI agents
- `GEMINI.md` — Gemini / Google AI
- `.cursor/rules/doc-wiki.mdc` — Cursor IDE
- `.aider/conventions.md` — Aider

All four route into the same orchestrator skill. The slash commands (`/doc-wiki:init`, etc.) work the same. Some interactive prompt UI may differ between hosts.

## Compared to alternatives

### How is this different from giving Claude my whole repo and asking?

Three things:

1. **Persistence.** Every query is archived; `/doc-wiki:promote` turns a useful answer into a permanent page. The wiki accumulates institutional knowledge — re-asking the same question costs $0.005 instead of `$cost-of-rereading-the-repo`.
2. **Drift detection.** Every wiki page records source content hashes. `/doc-wiki:lint` flags pages whose underlying code has changed, so stale documentation is detectable rather than invisible.
3. **Cross-source linking.** `gather()` pulls related context from Jira / Confluence / GitHub / DB schemas during ingest, so a single wiki page can synthesize code + the ticket that spec'd it + the design doc behind that ticket. See [recipe 6](recipes.md#6-multi-source-ingest-of-one-feature).

### Why Claude vs other models?

doc-wiki is built on the Claude Agent SDK, which the orchestrator skill uses for planning and synthesis. The connector framework (`narai-primitives`) is model-agnostic — the dispatcher is just a process spawner — but the wiki orchestrator itself, today, runs in Claude Code. Other AI tools (Cursor / Aider / Codex / Gemini) integrate via wrappers but still call the same skill.

If model-portability matters to you, the connectors and the deterministic TypeScript scripts (cache, lint, scoring, graph queries) are all model-independent — only the skill orchestration is Claude-flavored.

## Customization

### How do I customize topic discovery for `/doc-wiki:atlas`?

Three knobs:

1. **`wiki.config.yaml` `ecosystem.rest.enabled: true`** — atlas Phase 1b walks REST endpoints from 18 shipped framework profiles (Express, FastAPI, Django, Spring, ASP.NET, Rails, etc.). Adds them to the topic candidates.
2. **Custom REST profiles** under `ecosystem.rest.custom_profiles` — teach atlas about an in-house framework. See [`rest-profiles.md`](rest-profiles.md).
3. **`--scope <topic>`** at invocation time — restrict to one topic for incremental work.

Topic discovery itself unions five signals: top-level code dirs, ORM domains, existing wiki dirs, gitlog churn, and (when applicable) CLI command directories. See [`atlas.md` § Phase 2](atlas.md#phase-2--discover-topics).

### What happens if I rename a wiki page?

`/doc-wiki:lint` flags broken inbound links pointing at the old name. `/doc-wiki:lint --fix` resolves what it can unambiguously (single-target renames). For ambiguous cases, use `/doc-wiki:fix <surviving-page> "update reference to <new-name>"`.

If the rename was driven by an upstream source rename, `/doc-wiki:refresh --source <source>` will recompile from the new source name and the orphaned old-name page can be deleted by hand.

## Where to next

- Stuck on a specific error? → [`troubleshooting.md`](troubleshooting.md)
- Want a step-by-step tutorial? → [`getting-started.md`](getting-started.md)
- Looking up a command? → [`commands.md`](commands.md)
- Configuring something? → [`configuration.md`](configuration.md)
