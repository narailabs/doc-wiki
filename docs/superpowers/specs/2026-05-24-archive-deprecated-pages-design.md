# Design — Archive deprecated atlas pages to `wiki/_archive/`

**Status:** draft (pending approval)
**Date:** 2026-05-24
**Owner:** doc-wiki maintainers
**Affected:** atlas pipeline, `lint_checks`, `summaries_rebuild`, crosslink hook, tag-harmonize hook, `quality_score`, `_wiki_fs` walker, `parse_config`, `init_wiki`, `atlas_synthesize`, `atlas_orchestrator`, `atlas_validate`.

## Problem

Atlas detects pages whose source paths have been deleted from the code (Phase 5 structural + semantic checks), but the only remediation today is for users to manually `rm` orphaned pages. By explicit invariant atlas never deletes content. Result: deleted modules leave stranded documentation that pollutes search, indexes, quality scores, and synthesis bundles.

The user goal is to keep historical knowledge while removing it from the active documentation surface — the same "preserve, don't delete" pattern doc-wiki already uses for `outputs/queries/.promoted/`, `outputs/queries/.deleted/`, and `raw/history/`.

## Non-goals

- **No deletion.** Archive is move-and-mark, never `rm`.
- **No rename detection (MVP).** If a source path is renamed rather than deleted, the page will (correctly per source-existence rule) be flagged for archive. User can manually unarchive + update `sources:`. Git-follow detection is a follow-up.
- **No auto-resurrection.** When a deleted module is re-added, atlas generates a new page from scratch; the archived copy remains as a historical record.
- **No archiving of non-atlas pages.** Atlas owns the sweep, atlas-tagged pages (`atlas_facet` frontmatter) are its targets. Hand-authored / promoted pages are out of scope; users delete or archive those manually.
- **No archiving of URL-sourced atlas pages.** Atlas doesn't own remote source-of-truth; source-existence checks only apply to local paths.

## Design

### Directory layout

```
wiki/
├── _archive/                     ← reserved; underscore prefix excludes from globs
│   ├── index.md                  ← auto-maintained listing of archived pages
│   └── <topic>/
│       └── <page>.md             ← preserves original path under _archive/
├── _archive_history.jsonl        ← append-only archive event log
├── index.md
├── summaries.md
└── <topic>/...
```

`_archive/` is reserved. Code walking the wiki MUST skip directories starting with `_`. Single source of truth: extend `agents/lib/_wiki_fs.ts` to expose two named helpers:

- `walkLivePages(wikiRoot)` — every `.md` under `wiki/` except `_*` directories (default for all existing callers).
- `walkArchivedPages(wikiRoot)` — every `.md` under `wiki/_archive/`.

All current callers of the existing walker switch to `walkLivePages()`. Callers that need the archive (e.g. `_archive/index.md` regenerator) opt in to `walkArchivedPages()`.

### Frontmatter on archived pages

Four new fields, stamped at archive time:

```yaml
status: deprecated
archived_at: 2026-05-24
archive_reason: "all sources removed (src/billing/ no longer exists)"
archived_from: wiki/billing/architecture.md
```

`archived_from` is the original wiki-relative path before the move. Used for inbound-link rewriting and as a hint for the manual unarchive workflow. The page body is otherwise unchanged.

The existing `atlas_facet` and `atlas_run_id` are preserved (the page is still an atlas-managed page; it has simply transitioned to the deprecated state).

### Detection

`atlas_validate.js` gains a new subcommand `source-existence`:

```
atlas_validate.js source-existence --wiki-root <root> --repo-root <root> --page <page>
→ { status: "live" | "candidate" | "orphan", missing: string[], total: number, ratio: number }
```

For each `sources:` entry on the page:

- **URL** (`http(s)://`, `jira://`, `github://`, …): skipped — not a local-archive concern.
- **Local path**: existence check via `fs.access(repoRoot + path)`.

Aggregate:

- `total` = count of local-path sources
- `missing` = local paths that no longer exist
- `ratio` = `missing / total` (defined only when `total > 0`)

Decision:

| `ratio` | Status | Action |
|---|---|---|
| `1.0` | `orphan` | Archive (per autonomy) |
| `>= threshold && < 1.0` | `candidate` | Report in drift, never auto-archive |
| `< threshold` | `live` | No action |
| `total == 0` (URL-only page) | `live` | No action |

Default `threshold` is `1.0` — only archive when ALL local sources are gone. Configurable via `ecosystem.archive.partial_threshold` (range `0.0`–`1.0`).

Rationale for default: partial source removal frequently means refactor, not deletion. The drift-report entry surfaces the case for human triage on monthly cadence.

### Atlas pipeline integration

A new step is inserted between Phase 5 (Validate) and Phase 6 (Bootstrap/refresh):

```
1.  detect-state
1b. inventory
2.  discover topics
3.  confirm
4.  estimate cost
5.  validate existing
5b. archive sweep               ← NEW
6.  bootstrap / refresh
7.  synthesize globals
8.  finalize
```

**Sequencing rationale:**

- Runs **before** refresh/bootstrap so atlas doesn't waste cost re-fetching sources for orphan pages.
- Runs **before** Phase 6's topic discovery iteration so newly-archived pages don't influence in-run decisions.
- Runs **after** Phase 5 validation so semantic-cache state is already computed and we know which pages already-existed.
- Runs **before** Phase 7 global synthesis so `atlas_synthesize` bundles exclude archived pages from the inputs to `wiki/overview.md`, `wiki/integrations.md`, etc.

### Phase 5b script

New script `agents/lib/atlas_archive.ts` (sits with `atlas_inventory.ts` / `atlas_synthesize.ts` peers):

```
atlas_archive.js sweep \
  --wiki-root <root> \
  --repo-root <root> \
  --autonomy <mode> \
  --run-id <atlas_run_id> \
  [--dry-run]
```

Behavior:

1. Enumerate atlas pages via `walkLivePages(wikiRoot)`, filtering to pages with `atlas_facet` frontmatter.
2. For each, call `atlas_validate.source-existence`.
3. For each `orphan`, per autonomy mode (table below), move the file and stamp the four archive frontmatter fields.
4. Append one event per archive to `<wikiRoot>/_archive_history.jsonl`:
   ```json
   {"ts": "2026-05-24T15:42:00Z", "atlas_run_id": "2026-05-24T15-30-00", "from": "wiki/billing/architecture.md", "to": "wiki/_archive/billing/architecture.md", "reason": "all sources removed", "missing_sources": ["src/billing/"]}
   ```
5. Rewrite `wiki/_archive/index.md` from `_archive_history.jsonl` (newest first, grouped by archive month).
6. Trigger the inbound-link rewrite pass on live pages (see below).

`--dry-run` produces the report and journal-line previews without moving files — used by `/doc-wiki:atlas --dry-run` and the drift report under `conservative` autonomy.

### Autonomy gating

Mirrors the existing drift-handling table in SKILL.md:

| Autonomy | All sources gone (`orphan`) | Partial removal (`candidate`) |
|---|---|---|
| `conservative` | Report only in drift-report | Report only |
| `balanced` (default) | Ask per page (`Archive wiki/billing/architecture.md? [Y/n/skip-all]`) | Report only |
| `autonomous` | Auto-archive, log to event journal | Report only |
| `auto` | Auto-archive, log to event journal | Report only |

Partial removal **never** auto-archives — the safer default for unattended monthly runs.

### Inbound link handling

When a page is archived, scan all live pages for markdown links pointing at the archived path (the now-stale `wiki/<topic>/<page>.md`). Three modes, configurable via `ecosystem.archive.inbound_links`:

| Mode | Behavior | When to choose |
|---|---|---|
| `rewrite` (default) | `[label](wiki/billing/foo.md)` → `[label (archived)](wiki/_archive/billing/foo.md)` | Preserves provenance + clearly signals deprecation. Recommended. |
| `drop` | Remove the link, leave the label as plain text | Keeps live pages "clean" of any deprecation references |
| `leave` | No-op; rely on `lint_checks` to flag broken-link findings | Useful when downstream tooling already handles broken-link audits |

Implemented as an extension of the crosslink post-op hook: a new "archive-link rewrite" pass runs before fresh crosslink generation. Idempotent — re-running on a page with already-rewritten links is a no-op.

For atlas synthesis globals (`wiki/overview.md`, `wiki/integrations.md`, `wiki/deploy.md`, etc.): unconditionally regenerated in Phase 7 from current code state, so they naturally stop mentioning archived modules. No special handling needed.

### Exclusions across the codebase

| File | Today | Change |
|---|---|---|
| `skills/doc-wiki/scripts/_wiki_fs.ts` | Recursive walk of all `.md` under `wiki/` | Add `walkLivePages()` (default, excludes `_*` dirs) + `walkArchivedPages()` (only `_archive/`). |
| `skills/doc-wiki/scripts/lint_checks.ts` | Frontmatter + link validation across wiki | Skip archived pages from broken-link, isolated-node, code-ref-drift checks. Archived pages by definition have broken code refs — not findings. |
| `skills/doc-wiki/scripts/summaries_rebuild.ts` | Rebuild `wiki/summaries.md` | Skip archived pages. Their listing lives in `wiki/_archive/index.md`. |
| `skills/doc-wiki/scripts/quality_score.ts` | Score every page 0.0–1.0 | Skip archived. No quality penalty for being archived. |
| `skills/doc-wiki/scripts/atlas_orchestrator.ts` `detect-state` | Count atlas pages | Count LIVE atlas pages only. Archived pages don't influence "fresh / existing / hybrid". |
| `agents/lib/atlas_synthesize.ts` (overview, integrations, deploy, commands, configuration, getting-started, troubleshooting bundles) | Walk wiki for synthesis inputs | Exclude archived pages from input bundles. |
| `skills/doc-wiki/scripts/graph_ops.ts` | Path queries over `edges.jsonl` | Filter out nodes whose page lives under `_archive/`. (Edges referencing archived nodes are silently dropped, not error.) |
| Crosslink post-op hook | Add inline links + `## Related Pages` | Skip archived pages as link sources. Treat archived pages as link targets ONLY when a pre-existing link already points there. Never generate new inbound links to archived content. |
| Tag-harmonize post-op hook | Harmonize tags | Skip archived pages (frozen frontmatter). |
| `skills/doc-wiki/scripts/event_logger.ts` `stats` | Aggregate metrics | Optional `--include-archived` flag for historical analysis. Default excludes archived events from "active wiki" counts. |

### Config schema additions

New block in `wiki.config.yaml`:

```yaml
ecosystem:
  archive:
    enabled: true              # archive sweep runs in atlas Phase 5b
    partial_threshold: 1.0     # 1.0 = archive only when ALL local sources gone
    inbound_links: rewrite     # rewrite | drop | leave
```

`init_wiki.ts` writes defaults; `parse_config.ts` validates types and ranges. When `enabled: false`, Phase 5b is a no-op (logs that archive is disabled and skips).

### `/doc-wiki:unarchive` command

Symmetric with the archive sweep — restores an archived page to its original location without requiring the user to touch git or frontmatter manually.

**Synopsis:**

```text
/doc-wiki:unarchive <path-or-slug> [--target <wiki-relative-path>] [--yes]
```

| Arg / flag | Default | Behavior |
|---|---|---|
| `<path-or-slug>` | (required) | Either `wiki/_archive/<topic>/<page>.md` (full path) or a single-token slug. Slug resolution mirrors `/doc-wiki:promote`: substring match against archived filenames; if 0 or >1 match, list candidates and ask. |
| `--target <path>` | `archived_from` frontmatter field | Override the restoration target. Useful when the original topic dir was also deleted. |
| `--yes` | off | Skip the per-page confirmation prompt under `balanced`/`conservative` autonomy. |

**Flow (executed by the skill orchestrator — user types only the slash command):**

1. Resolve the page; read its frontmatter; extract `archived_from`.
2. Determine target path (`--target` if supplied, otherwise `archived_from`). If the target's parent directory doesn't exist, create it.
3. If a live page already exists at the target path, abort with a clear error ("`<target>` exists; pass `--target` to restore to a different location"). Never overwrite a live page.
4. Move the file (`git mv` equivalent — atlas uses the filesystem move and lets git pick up the rename).
5. Strip the four archive frontmatter fields (`status`, `archived_at`, `archive_reason`, `archived_from`). Preserve every other field, including `atlas_facet` and `atlas_run_id`.
6. Append an `unarchived` event to `<wikiRoot>/_archive_history.jsonl`:
   ```json
   {"ts": "2026-05-24T16:10:00Z", "op": "unarchive", "from": "wiki/_archive/billing/architecture.md", "to": "wiki/billing/architecture.md"}
   ```
7. Rewrite `wiki/_archive/index.md` (the restored page disappears from the listing).
8. Run an "unarchive-link rewrite" pass — inverse of the archive-link rewrite. Live pages whose links were rewritten to `(archived)` form get reverted: `[label (archived)](wiki/_archive/billing/foo.md)` → `[label](wiki/billing/foo.md)`. Match keyed off the link's path resolving under `_archive/` and matching the unarchived file. Idempotent on re-run.
9. Run the standard post-op hooks (crosslink + tag-harmonize) so the restored page rejoins inbound link discovery, summaries, and quality scoring.

**Autonomy gating:** simpler than archive — unarchive is always user-initiated, so `conservative` and `balanced` ask one confirmation per invocation ("Restore `<page>` to `<target>`? [Y/n]"); `autonomous` and `auto` proceed without prompt. `--yes` overrides at any level.

**Slash-command wrapper:** `commands/doc-wiki:unarchive.md` — thin pass-through to the skill, same pattern as the other ten wrappers.

### `wiki/_archive/index.md`

Auto-maintained. Read-only from the user's perspective — rewritten on every atlas run that performs archive activity. The file IS committed to the repo (history-on-disk is the point).

Layout:

```markdown
# Archived Pages

This index lists pages atlas has archived. Pages here are preserved for historical
reference but excluded from the main wiki indexes, summaries, search, and synthesis.

**To restore an archived page:** run `/doc-wiki:unarchive <path>` — the command moves the file back, strips deprecation frontmatter, and rewrites inbound `(archived)` links. No manual git or frontmatter edits.

## 2026-05

- [billing/architecture.md](billing/architecture.md) — archived 2026-05-24, all sources removed (`src/billing/`)
- ...

## 2026-04

- ...
```

Generated by sorting `_archive_history.jsonl` events newest-first, grouped by `YYYY-MM`.

## Edge cases

1. **Page with mixed local + URL sources** — URL sources are not checked. If all *local* sources are gone but a URL source remains, the page still archives (local-source absence is the trigger). URL-sourced pages with no local sources are out of scope (`total == 0` → `live`).

2. **Source path renamed (not deleted)** — false-positive archive. Manual unarchive needed; document the workflow in `_archive/index.md`. Git-follow detection deferred.

3. **Page manually `git rm`'d between runs** — Phase 5b finds no atlas page to archive; no-op. Correct behavior.

4. **Concurrent atlas runs** — archive sweep is not idempotent under races. Atlas already uses `.wiki-checkpoint.json` to serialize runs; same checkpoint covers Phase 5b. Checkpoint records completed `(topic, facet)` pairs as before; Phase 5b records completed `<original-path>:archived` entries so resume after interruption skips them.

5. **Atlas page linked from a non-atlas (hand-authored) page** — inbound-link rewrite scans ALL live pages, not just atlas pages. Hand-authored page's link to the now-archived page is rewritten per `inbound_links` mode.

6. **Live page links to archived page via relative path** (`./other-topic/foo.md`) — link resolution normalizes to absolute wiki-relative path before match. Idempotent on re-run.

7. **A page is both an orphan AND would be a refresh target this run** (sources removed since last refresh) — archive wins; refresh is skipped for that page. Logged in drift report so it's auditable.

8. **`wiki/_archive/index.md` itself has no `atlas_facet`** — it's a maintenance page, not an atlas page. Lint treats it as a special-case "managed file" (similar to `wiki/summaries.md`).

## Migration / backwards compatibility

- Existing wikis without `_archive/` or `ecosystem.archive` config: no behavior change until next atlas run. `parse_config.ts` writes the new block with defaults on first read after upgrade.
- First atlas run after upgrade WILL discover orphan pages from prior code deletions and act per autonomy mode. Conservative users see the drift report only; autonomous users see a sweep on day one. **Documented in CHANGELOG** so it's not a surprise.
- `_archive/` directory is created lazily on first archive event, not eagerly during config migration.
- `_archive_history.jsonl` is created lazily on first archive event.

## Open questions for review

Three design decisions called out previously — explicit confirmation requested.

1. **Inbound links default = `rewrite`** (with `(archived)` label). Alternatives: `drop`, `leave`. Rewrite preserves provenance and signals deprecation in the rendered output.

2. **Resurrection = always fresh.** When a module is re-added after archive, atlas generates a new page from scratch; the archived copy stays as historical record. Alternative: auto-unarchive on resurrection. "Fresh" sidesteps merge-conflict cases and matches `raw/history/` semantics.

3. **Partial-removal threshold = `1.0`** (only archive when ALL local sources gone). Configurable via `ecosystem.archive.partial_threshold`. `1.0` is the safer default for monthly unattended runs.

## Implementation outline

Detailed task-by-task plan deferred to a separate `docs/superpowers/plans/2026-05-24-archive-deprecated-pages.md` after approval.

**New code:**

- `agents/lib/atlas_archive.ts` (+ tests) — sweep logic, frontmatter mutation, history log append, index rebuilder, unarchive logic
- `skills/doc-wiki/scripts/atlas_validate.ts` — new `source-existence` subcommand
- `skills/doc-wiki/scripts/_wiki_fs.ts` — `walkLivePages()` / `walkArchivedPages()` helpers
- `commands/doc-wiki:unarchive.md` — slash-command wrapper
- Crosslink hook — archive-link rewrite pass (forward + inverse for unarchive)

**Modified code:**

- All callers of `_wiki_fs` walker → `walkLivePages()`
- `skills/doc-wiki/scripts/lint_checks.ts`, `summaries_rebuild.ts`, `quality_score.ts`, `atlas_orchestrator.ts`, `graph_ops.ts` — exclusion logic
- `agents/lib/atlas_synthesize.ts` — exclude archived pages from all seven bundles
- `agents/lib/parse_config.ts` — `ecosystem.archive` schema
- `skills/doc-wiki/scripts/init_wiki.ts` — default config block
- `skills/doc-wiki/SKILL.md` — Phase 5b section + autonomy table row + frontmatter conventions update
- `docs/internals/architecture.md` — archive mechanism overview
- `docs/atlas.md` — user-facing archive workflow doc
- `docs/configuration.md` — `ecosystem.archive` field reference
- `CLAUDE.md`, `AGENTS.md`, `GEMINI.md` — one-line mention of `_archive/`

**Test additions:**

- Sweep happy-path: orphan detected → moved + stamped + history logged + index rebuilt
- Partial removal at threshold boundaries: 0.5 ratio with threshold 1.0 → no archive; threshold 0.5 → archive
- Inbound link rewrite: live page A links to page B; B is archived; link gets `(archived)` label and `_archive/` path
- Inbound link modes: `drop` and `leave` produce expected outputs
- Autonomy gates: conservative=report only, balanced=ask, autonomous=auto
- Idempotence: re-running atlas on already-archived page no-ops; inbound-link rewrite is a no-op on already-rewritten links
- Concurrent run safety: second invocation respects checkpoint
- URL-only pages: not archived regardless of local-source absence
- Lint exclusion: archived page with broken refs doesn't generate findings
- Summary exclusion: archived page absent from `summaries.md`
- Synthesis exclusion: archived page absent from `wiki/overview.md` input bundle
- Unarchive happy-path: archived page → `/doc-wiki:unarchive <slug>` restores file, strips frontmatter, reverts inbound `(archived)` links
- Unarchive collision: target path already occupied → command aborts without overwriting
- Unarchive with `--target`: file moves to override path; original `archived_from` is ignored
- Unarchive slug resolution: ambiguous slug → command lists candidates; unique slug → resolves silently
- Unarchive idempotence: link-rewrite pass is a no-op when no inbound `(archived)` links remain

---

**Next step:** approve / amend the three open questions above, then I'll write the task-by-task implementation plan at `docs/superpowers/plans/2026-05-24-archive-deprecated-pages.md`.
