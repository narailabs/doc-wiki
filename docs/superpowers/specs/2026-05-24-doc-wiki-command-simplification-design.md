# Design — Simplify the `/doc-wiki:*` command surface (10 → 7)

**Status:** draft (pending approval)
**Date:** 2026-05-24
**Owner:** doc-wiki maintainers
**Affected:** `commands/*.md`, `skills/doc-wiki/SKILL.md`, `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `.cursor/rules/doc-wiki.mdc`, `.aider/conventions.md`, `README.md`, `docs/commands.md`, `docs/getting-started.md`, `docs/atlas.md`, `docs/troubleshooting.md`.

## Problem

doc-wiki ships 10 slash commands (`init`, `onboard`, `atlas`, `ingest`, `query`, `lint`, `fix`, `promote`, `refresh`, `stats`). The surface is wider than the underlying capability set warrants — several verbs are sibling operations on the same underlying noun (e.g., `refresh` is "re-run ingest", `fix` is "edit one page", `promote` is "save a query answer"). The result:

- New users see 10 commands and don't know where to start.
- First-run flow is split across two commands (`init` then `onboard`) and the user must remember to chain `atlas` afterward.
- Natural-language requests like "ingest this URL" or "save my last answer" don't reliably trigger the skill because the description undersells the trigger surface.

Goal: consolidate the surface to 7 commands, make the first-run experience a single command, and rewrite the skill description to Anthropic's published best-practices so Claude routes natural-language requests deterministically (without requiring an explicit slash invocation).

## Non-goals

- **No changes to underlying logic.** TypeScript scripts under `skills/doc-wiki/scripts/`, agents under `agents/`, and connector libraries are not modified. This is a surface-and-dispatch change only.
- **No deprecation shims.** Removed commands are deleted outright; migration is via documentation. (Personal tool; no external user base to ease over.)
- **No new capabilities.** Every flow reachable today remains reachable; some are reached via flags on the surviving commands instead of as separate top-level commands.
- **No `narai-primitives` changes.** Connector behavior is untouched.

## Design

### Final command surface (7 commands)

| Command | Replaces | Behavior |
|---|---|---|
| `/doc-wiki:init` | `init` + `onboard` (+ optional atlas chain) | Scaffold → onboard Q&A → `AskUserQuestion` "Run atlas now?" → optionally chain `atlas`. `--no-atlas` skips the prompt; `--atlas` skips the prompt and runs unconditionally. |
| `/doc-wiki:atlas` | `atlas` (unchanged) | Full doc generation pipeline. Reachable directly, or chained from `init`. |
| `/doc-wiki:ingest` | `ingest` + `refresh` | `ingest <src>` (single new source) **or** `ingest --refresh [--source <s> \| --all]` (re-fetch previously ingested). |
| `/doc-wiki:query` | `query` + `promote` | `query <q>` (synthesis) **or** `query --from a --to b` (path) **or** `query --promote <file\|last\|N>` (promote archive) **or** `query --review` (bulk archive triage). After synthesis-mode answers, post-answer prompt: "Save this as a permanent wiki page?". |
| `/doc-wiki:lint` | `lint` (unchanged) | Wiki-wide health check + auto-heal. |
| `/doc-wiki:edit` | `fix` (renamed) | Targeted page correction. `fix` is renamed to `edit` because the command is really "modify this page for any reason" — `fix` implies broken state and collides semantically with `lint`'s auto-heal. |
| `/doc-wiki:stats` | `stats` (unchanged) | Token-efficiency and cost metrics. |

Removed: `onboard`, `refresh`, `promote`, `fix`. Renamed: `fix` → `edit`.

### `/doc-wiki:init` flow detail

```
1. Parse args (--path, --domain, --name, --no-atlas, --atlas).
   - --atlas and --no-atlas are mutually exclusive. Passing both errors with a clear message before any side effects.
2. Detect existing state:
   a. If wiki.config.yaml exists → AskUserQuestion "Wiki already initialized. Re-run onboarding?" (scaffold is skipped either way).
      - Yes → continue to step 3.
      - No → skip step 3 and jump to step 4.
   b. Otherwise → run scaffold (the old /doc-wiki:init flow), then continue to step 3.
3. Run onboarding Q&A (the old /doc-wiki:onboard flow):
   - Detect language/framework
   - Detect ORM via wiki-orm-agent
   - Detect DB via wiki-db-agent
   - Q&A for external services
   - Choose autonomy mode
   - Install hooks
4. Atlas decision:
   - If --no-atlas: stop.
   - If --atlas: dispatch /doc-wiki:atlas with default facets.
   - Otherwise: AskUserQuestion "Generate full documentation now with /doc-wiki:atlas? (Recommended for first-run.)"
     - Yes → dispatch /doc-wiki:atlas.
     - No → stop, print "Run /doc-wiki:atlas later when ready."
```

Idempotent re-runs: detecting an existing `wiki.config.yaml` short-circuits scaffold; onboarding only re-runs if the user confirms. Re-running on an initialized wiki is always at least a fast-path to the atlas prompt — useful for users who want to regenerate docs after code changes without typing two commands.

### `/doc-wiki:ingest --refresh` mode

`ingest <src>` and `ingest --refresh` are mutually exclusive. The wrapper parses argv and dispatches to either the new-source path or the re-fetch path inside the skill's `/doc-wiki:ingest` section. `--source <s>` re-fetches one source; `--all` re-fetches every source recorded in `<wikiRoot>/raw/index.json`. This is the same flow `refresh` ran today — the entry point moves, the logic stays put.

### `/doc-wiki:query` promote integration

Three new dispatch modes added to the existing `query` section:

1. **Post-answer prompt** (synthesis mode only; not path mode): after rendering the synthesis answer + citations, run `AskUserQuestion` "Save this answer as a permanent wiki page?". Gated by the configured autonomy mode the same way other auto-prompts are. Yes → run the existing `promote` single-mode logic on the just-written archive.
2. **`--promote <file|last|N>`**: explicit promote of an archived answer. Same arg resolution as old `/doc-wiki:promote` (path / `last` / `latest` / integer `N` / substring match / list-and-pick).
3. **`--review [--since <dur>] [--limit <N>] [--topic <dir>]`**: bulk archive triage, same as old `/doc-wiki:promote --review`.

Old `/doc-wiki:promote` is fully reachable via these three modes.

### `/doc-wiki:edit` (renamed from `fix`)

Behavior unchanged. Just the command name and surface description change. The flow (read page, show diff, apply if autonomy permits, log event, run post-op hooks) is identical.

### Skill description rewrite

Replace the `description:` frontmatter line in `skills/doc-wiki/SKILL.md` with:

> Manage the current codebase's doc-wiki: bootstrap with optional atlas (init), full-doc generation (atlas), source ingest from Jira/Confluence/GitHub/Notion/AWS/GCP/databases/files/URLs with `--refresh` for re-fetch (ingest), search + synthesis with promote-to-page and shortest-path modes (query), health check + self-heal (lint), targeted page edit (edit), token/cost metrics (stats). Always invoke when the user mentions "the wiki" or "the docs", or asks to: set up doc-wiki, onboard this repo, ingest a URL into docs, refresh docs, look up something in the wiki, find a path between two concepts, save the last query answer as a page, check wiki health, fix/edit a wiki page, or see wiki cost metrics — even if "wiki" is not said explicitly. Slash commands: `/doc-wiki:init`, `:atlas`, `:ingest`, `:query`, `:lint`, `:edit`, `:stats`. Skip for unrelated docs work (arbitrary README edits, code comments, projects without `wiki.config.yaml`).

Conformance to Anthropic's [Skill authoring best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices):

- ≤ 1024 character limit (≈ 990 chars).
- Third-person imperative voice ("Manage", "Always invoke", "Skip").
- Includes both what the skill does AND when to use it.
- Lists explicit trigger phrases per capability for natural-language matching.
- Pushy language ("Always invoke", "even if 'wiki' is not said explicitly") to combat undertriggering.
- Explicit SKIP clause to prevent false positives in projects without doc-wiki.

### Wrapper file changes

| File | Action |
|---|---|
| `commands/init.md` | Update — new combined description, `argument-hint` includes `[--no-atlas] [--atlas]`. |
| `commands/onboard.md` | Delete. |
| `commands/atlas.md` | Untouched. |
| `commands/ingest.md` | Update — `argument-hint` adds `[--refresh [--source <s> \| --all]]`. |
| `commands/refresh.md` | Delete. |
| `commands/query.md` | Update — `argument-hint` adds `[--promote <file>] [--review ...]`. Description mentions post-answer promote prompt. |
| `commands/promote.md` | Delete. |
| `commands/lint.md` | Untouched. |
| `commands/fix.md` | Delete. |
| `commands/edit.md` | **Create** (new file). Wrapper for `/doc-wiki:edit`. Same shape as old `fix.md`, with description "Edit a wiki page" and `argument-hint: '<page-path> <change-description>'`. |
| `commands/stats.md` | Untouched. |

### `skills/doc-wiki/SKILL.md` restructure

- Rewrite the frontmatter `description:` line (above).
- Update the top-level command index / routing table near the top of the file to list the 7 surviving commands.
- Merge the entire `/doc-wiki:onboard` section into `/doc-wiki:init`, with the atlas-prompt step appended at the end.
- Delete the standalone `/doc-wiki:onboard` section.
- Delete the standalone `/doc-wiki:refresh` section; fold its content into a `--refresh` subsection under `/doc-wiki:ingest`.
- Delete the standalone `/doc-wiki:promote` section; fold its content into `/doc-wiki:query` as three subsections (post-answer prompt, `--promote`, `--review`).
- Delete the standalone `/doc-wiki:fix` section; rename its content to `/doc-wiki:edit` and lift verbatim (no behavior change).

### Cascading doc updates

| File | Change |
|---|---|
| `CLAUDE.md` (project root) | "Slash commands (10)" → "(7)"; rewrite the wrapper-file list; update Quickstart to drop the separate onboard step. |
| `AGENTS.md`, `GEMINI.md` | Mirror the SKILL.md description rewrite. |
| `.cursor/rules/doc-wiki.mdc`, `.aider/conventions.md` | Same — mirror the description rewrite. |
| `docs/commands.md` | Rewrite to document the 7 commands. Add a "Removed commands" section mapping old → new for migration (onboard → init, refresh → ingest --refresh, promote → query --promote/--review, fix → edit). |
| `docs/getting-started.md` | Update quickstart: single-command first-run via `/doc-wiki:init`. |
| `README.md` | Update the Quickstart block — drop the separate `/doc-wiki:onboard` line. |
| `docs/atlas.md` | Mention the new `init`-chained invocation as an entry point. |
| `docs/troubleshooting.md` | Add migration FAQ entries: "Where did `/doc-wiki:onboard` go?", "Where did `/doc-wiki:refresh` go?", "Where did `/doc-wiki:promote` go?", "Where did `/doc-wiki:fix` go?" — each pointing at the new home. |

### Deprecation policy

**Hard delete** for `onboard.md`, `refresh.md`, `promote.md`, `fix.md`. No shim wrappers. Migration is documented in `docs/commands.md` ("Removed commands") and `docs/troubleshooting.md` (FAQ entries).

Rationale: doc-wiki is a personal tool with no external user base. Shims would clutter the autocomplete and discourage migration. The migration mapping is one table.

## Migration mapping (for `docs/commands.md` "Removed commands")

| Old command | New invocation |
|---|---|
| `/doc-wiki:onboard` | Run `/doc-wiki:init` on a wiki that's already scaffolded — onboarding will re-run after confirmation. |
| `/doc-wiki:refresh` | `/doc-wiki:ingest --refresh [--source <s> \| --all]` |
| `/doc-wiki:promote <file>` | `/doc-wiki:query --promote <file>` (or accept the post-answer prompt after a synthesis query) |
| `/doc-wiki:promote --review` | `/doc-wiki:query --review` |
| `/doc-wiki:fix <page> "<issue>"` | `/doc-wiki:edit <page> "<change>"` |

## Out of scope

- **TypeScript scripts under `skills/doc-wiki/scripts/`** — no logic changes. The same scripts back the new surface.
- **`agents/` and `agents/lib/`** — untouched.
- **`narai-primitives` and connectors** — untouched.
- **`wiki.config.yaml` schema** — unchanged. No new config keys needed.
- **Behavior of individual subcommands beyond dispatch** — `ingest` still ingests the same way, `query` still synthesizes the same way, etc.

## Validation criteria

After implementation:

1. Slash-command autocomplete shows exactly 7 `/doc-wiki:*` entries.
2. `/doc-wiki:init` on a fresh repo: scaffolds → onboards → asks about atlas → on confirmation runs atlas → wiki is fully usable.
3. `/doc-wiki:init` on an initialized wiki: prompts to re-run onboarding; on accept, re-runs; on decline, falls through to atlas prompt.
4. `/doc-wiki:ingest --refresh --all` re-fetches every source recorded under `<wikiRoot>/raw/index.json` (parity with the old `/doc-wiki:refresh`).
5. `/doc-wiki:query "<q>"` ends with a "Save as wiki page?" prompt; accepting it produces the same wiki page that `/doc-wiki:promote last` would have produced.
6. `/doc-wiki:query --review` matches the behavior of the old `/doc-wiki:promote --review`.
7. `/doc-wiki:edit <page> "<change>"` matches the behavior of the old `/doc-wiki:fix <page> "<issue>"`.
8. A natural-language request like "ingest the contents of https://example.com/spec into the wiki" or "save my last wiki answer as a page" triggers the doc-wiki skill without an explicit slash command.
9. The description field on `skills/doc-wiki/SKILL.md` is ≤ 1024 characters, third-person, and contains explicit SKIP conditions.
10. `npm test` and `npm run typecheck` continue to pass.
