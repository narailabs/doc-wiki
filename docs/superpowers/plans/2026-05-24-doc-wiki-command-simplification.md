# Doc-Wiki Command Simplification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate the doc-wiki slash-command surface from 10 → 7 commands (merge onboard into init, fold refresh into ingest, fold promote into query, rename fix → edit), and rewrite the skill description per Anthropic's best practices for reliable natural-language triggering.

**Architecture:** Pure surface-and-dispatch refactor. No TypeScript scripts, agent definitions, connector packages, or `wiki.config.yaml` schema are touched. Work is concentrated in (a) `skills/doc-wiki/SKILL.md` (the orchestrator), (b) `commands/*.md` (10 thin slash-command wrappers), and (c) cascaded doc updates in user-facing files (`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `.cursor/rules/doc-wiki.mdc`, `.aider/conventions.md`, `README.md`, and several `docs/*.md` files).

**Tech Stack:** Markdown only. Verification uses `grep`, `ls`, `wc`, and the existing `npm test` / `npm run typecheck` test infrastructure (which should remain green throughout since no logic changes).

**Spec:** [`docs/superpowers/specs/2026-05-24-doc-wiki-command-simplification-design.md`](../specs/2026-05-24-doc-wiki-command-simplification-design.md)

---

## File structure

### Files modified

| File | Responsibility | Change type |
|---|---|---|
| `skills/doc-wiki/SKILL.md` | Skill orchestrator — frontmatter description + per-command dispatch sections | Rewrite description; restructure sections (delete 4, fold 4 sets of content) |
| `commands/init.md` | Slash-wrapper for `/doc-wiki:init` | Update behavior + argument-hint |
| `commands/ingest.md` | Slash-wrapper for `/doc-wiki:ingest` | Add `--refresh` to argument-hint + body |
| `commands/query.md` | Slash-wrapper for `/doc-wiki:query` | Add `--promote` and `--review` modes |
| `CLAUDE.md` | Project-memory file for Claude Code | Update wrapper count, file list, Quickstart |
| `AGENTS.md` | Codex / OpenAI agents wrapper | Mirror new description |
| `GEMINI.md` | Gemini wrapper | Mirror new description |
| `.cursor/rules/doc-wiki.mdc` | Cursor wrapper | Mirror new description |
| `.aider/conventions.md` | Aider wrapper | Mirror new description |
| `README.md` | Repo entry point | Update Quickstart block (drop separate onboard step) |
| `docs/commands.md` | Per-command documentation | Rewrite for 7 commands + add "Removed commands" migration section |
| `docs/getting-started.md` | First-run walkthrough | Update to single-command quickstart |
| `docs/atlas.md` | Atlas reference | Mention `init`-chained invocation as entry point |
| `docs/troubleshooting.md` | Troubleshooting FAQ | Add migration FAQ entries |

### Files created

| File | Responsibility |
|---|---|
| `commands/edit.md` | New slash-wrapper for `/doc-wiki:edit` (renamed from `fix`) |

### Files deleted

| File | Why |
|---|---|
| `commands/onboard.md` | Folded into `/doc-wiki:init` |
| `commands/refresh.md` | Folded into `/doc-wiki:ingest --refresh` |
| `commands/promote.md` | Folded into `/doc-wiki:query --promote / --review` |
| `commands/fix.md` | Renamed to `commands/edit.md` |

### Files untouched

`atlas.md`, `lint.md`, `stats.md` wrappers; all of `skills/doc-wiki/scripts/`, `agents/`, `agents/lib/`, `narai-primitives`, `wiki.config.yaml`, all tests.

### Validation strategy

This is a doc/wrapper refactor with no testable units of behavior. Instead of write-test-first cycles, each task uses a **state-check pattern**:

1. **Capture current state** with `grep`/`ls` so the engineer can see what needs to change.
2. **Apply the change** with `Edit`, `Write`, or `rm`.
3. **Verify the new state** with the same `grep`/`ls` invocation.
4. **Commit** with a focused message.

`npm run typecheck` and `npm test` MUST stay green throughout. They cannot detect the doc changes but they catch accidental breakage in adjacent code that gets touched by mistake.

### Commit cadence

One commit per task (10 total). Commits use conventional-commits prefix (`docs(doc-wiki):` for most; `feat(doc-wiki):` if a wrapper's externally-observable behavior changes).

---

## Task 1: Rewrite SKILL.md frontmatter description and command index

**Files:**
- Modify: `skills/doc-wiki/SKILL.md` (lines 1-4 frontmatter; line 31-32 command index header)

- [ ] **Step 1: Capture current frontmatter**

Run: `head -4 skills/doc-wiki/SKILL.md`

Expected output:
```
---
name: doc-wiki
description: Manage a documentation wiki — generate, ingest sources, query, lint, fix, promote, refresh. Triggers on requests about documentation, knowledge bases, archived queries, ORM mapping, or database schemas, including phrasings like "promote last query", "lint the wiki", or "fix the auth page".
---
```

- [ ] **Step 2: Rewrite the frontmatter `description:` line**

Edit `skills/doc-wiki/SKILL.md` to replace the `description:` line. Use this exact replacement (one line, no wrapping):

Old:
```
description: Manage a documentation wiki — generate, ingest sources, query, lint, fix, promote, refresh. Triggers on requests about documentation, knowledge bases, archived queries, ORM mapping, or database schemas, including phrasings like "promote last query", "lint the wiki", or "fix the auth page".
```

New:
```
description: Manage the current codebase's doc-wiki — bootstrap with optional atlas (init), full-doc generation (atlas), source ingest from Jira/Confluence/GitHub/Notion/AWS/GCP/databases/files/URLs with `--refresh` for re-fetch (ingest), search + synthesis with promote-to-page and shortest-path modes (query), health check + self-heal (lint), targeted page edit (edit), token/cost metrics (stats). Always invoke when the user mentions "the wiki" or "the docs", or asks to set up doc-wiki, onboard this repo, ingest a URL into docs, refresh docs, look up something in the wiki, find a path between two concepts, save the last query answer as a page, check wiki health, fix/edit a wiki page, or see wiki cost metrics — even if "wiki" is not said explicitly. Slash commands — `/doc-wiki:init`, `:atlas`, `:ingest`, `:query`, `:lint`, `:edit`, `:stats`. Skip for unrelated docs work (arbitrary README edits, code comments, projects without `wiki.config.yaml`).
```

(Note: em-dash `—` and parentheses replace the original colons because the YAML parser treats `:` specially. Verify by viewing the file in raw text after the edit.)

- [ ] **Step 3: Verify description is under 1024 chars and lint-clean**

Run: `awk '/^---$/{c++;next} c==1 && /^description:/ { sub(/^description: /, ""); print length($0) }' skills/doc-wiki/SKILL.md`

Expected: a single number between 800 and 1024 (the new description's character count).

Run: `head -5 skills/doc-wiki/SKILL.md`

Expected: frontmatter block intact with the new description on a single line, closing `---` on line 4.

- [ ] **Step 4: Update the top-of-file Commands section index**

The `## Commands` heading (around line 31) is currently followed directly by the `### /doc-wiki:init` section. Add an explicit overview list of the 7 surviving commands immediately after the `## Commands` heading so readers see the new surface at a glance.

Edit `skills/doc-wiki/SKILL.md` — find:
```
## Commands

### /doc-wiki:init — Bootstrap a wiki
```

Replace with:
```
## Commands

The wiki exposes 7 slash commands, dispatched by this section. Each subsection below documents the flow:

- `/doc-wiki:init` — scaffold + onboard (+ optional atlas chain)
- `/doc-wiki:atlas` — full application documentation
- `/doc-wiki:ingest` — fetch + extract + compile a source (`--refresh` re-fetches)
- `/doc-wiki:query` — summary-first search and synthesis (`--promote` saves an answer; `--review` triages archives)
- `/doc-wiki:lint` — health check + auto-heal
- `/doc-wiki:edit` — targeted page changes
- `/doc-wiki:stats` — token efficiency and cost metrics

### /doc-wiki:init — Bootstrap a wiki
```

- [ ] **Step 5: Verify**

Run: `grep -n '^### /doc-wiki' skills/doc-wiki/SKILL.md`

After Task 1 alone this still shows the old 10 section headers — that's expected; subsequent tasks remove and rename them. The point here is just that we haven't broken the file: no headers should have been moved or duplicated.

Run: `npm run typecheck`

Expected: PASS (this task touches no TypeScript).

- [ ] **Step 6: Commit**

```bash
git add skills/doc-wiki/SKILL.md
git commit -m "docs(doc-wiki): rewrite SKILL.md description for natural-language triggering"
```

---

## Task 2: Consolidate `init` + `onboard` sections in SKILL.md

**Files:**
- Modify: `skills/doc-wiki/SKILL.md` (init section ~lines 33-57; onboard section ~lines 58-198; delete onboard standalone, append its content to init plus atlas-prompt)

- [ ] **Step 1: Read the current init section (lines 33-57)**

Run: `sed -n '33,57p' skills/doc-wiki/SKILL.md`

Note what's there so the merge preserves existing content. Capture roughly: heading, intro sentence, step list for scaffolding, arg-defaults note.

- [ ] **Step 2: Read the current onboard section (lines 58-198)**

Run: `sed -n '58,198p' skills/doc-wiki/SKILL.md`

Note: six-phase Q&A flow (language detect → ORM detect → DB detect → ecosystem Q&A → autonomy → hook install + scaffold).

- [ ] **Step 3: Rewrite the init section header and intro to reflect the merged behavior**

Edit `skills/doc-wiki/SKILL.md`. Change the section heading and intro paragraph(s) only — keep the existing scaffold-step list intact. The merged section's structure becomes:

```markdown
### /doc-wiki:init — Bootstrap a wiki (scaffold + onboard + optional atlas)

This is the single first-run command. It scaffolds the wiki directory, runs the ecosystem onboarding Q&A, and offers to dispatch `/doc-wiki:atlas` at the end so a brand-new repo reaches a usable wiki in one invocation.

**Args:** `[--path <root>] [--domain <d>] [--name <n>] [--no-atlas | --atlas]`

`--atlas` and `--no-atlas` are mutually exclusive; passing both errors before any side effects.

**Phase 1 — Detect existing state.**
- If `<root>/wiki.config.yaml` exists: `AskUserQuestion` "Wiki already initialized. Re-run onboarding?". Skip Phase 2 (scaffold) either way; on "yes" continue to Phase 3 (onboarding Q&A); on "no" skip directly to Phase 4 (atlas decision).
- Otherwise: continue to Phase 2.

**Phase 2 — Scaffold.**
(insert the existing scaffold step list here — the directory creation, default config, etc.)

**Phase 3 — Onboarding Q&A.**
(insert the existing onboard section's six-phase flow here verbatim — language/framework detect, ORM via wiki-orm-agent, DB via wiki-db-agent, ecosystem services Q&A, autonomy choice, hooks install.)

**Phase 4 — Atlas decision.**
- If `--no-atlas`: stop.
- If `--atlas`: dispatch `/doc-wiki:atlas` with the default facet set.
- Otherwise: `AskUserQuestion` "Generate full documentation now with /doc-wiki:atlas? (Recommended for first-run.)"
  - Yes → dispatch `/doc-wiki:atlas`.
  - No → stop, print "Run /doc-wiki:atlas later when ready."
```

When transcribing the existing onboard flow into Phase 3, lift its content verbatim — do not rewrite it. The goal is consolidation, not behavioral change.

- [ ] **Step 4: Delete the standalone `### /doc-wiki:onboard — Interactive onboarding Q&A` section**

Now that the onboard content lives inside the init section, delete the standalone section. In `skills/doc-wiki/SKILL.md`, find and delete everything from the line `### /doc-wiki:onboard — Interactive onboarding Q&A` up to (but not including) the next `### ` heading.

- [ ] **Step 5: Verify**

Run: `grep -n '^### /doc-wiki:' skills/doc-wiki/SKILL.md`

Expected: no entry for `/doc-wiki:onboard`. The init entry should still be present.

Run: `grep -c 'Phase 3 — Onboarding' skills/doc-wiki/SKILL.md`

Expected: `1` (the consolidated phase is named exactly once).

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add skills/doc-wiki/SKILL.md
git commit -m "docs(doc-wiki): merge /doc-wiki:onboard into /doc-wiki:init with atlas hook"
```

---

## Task 3: Fold `refresh` into `ingest` section in SKILL.md

**Files:**
- Modify: `skills/doc-wiki/SKILL.md` (ingest section ~lines 363-432; refresh section ~lines 561-566; add `--refresh` subsection to ingest, delete refresh standalone)

- [ ] **Step 1: Read the current refresh section**

Run: `grep -n '^### /doc-wiki:refresh' skills/doc-wiki/SKILL.md`

Capture the exact line number, then:

```bash
START=$(grep -n '^### /doc-wiki:refresh' skills/doc-wiki/SKILL.md | cut -d: -f1)
END=$(awk -v s="$START" 'NR>s && /^### / {print NR-1; exit}' skills/doc-wiki/SKILL.md)
sed -n "${START},${END}p" skills/doc-wiki/SKILL.md
```

Note the refresh-flow steps so they can be reproduced as a subsection inside ingest.

- [ ] **Step 2: Append a `Re-fetching with --refresh` subsection to the ingest section**

Find the end of the existing `### /doc-wiki:ingest` section (immediately before the next `### ` heading, which is `### /doc-wiki:query`). Insert at that point:

```markdown

#### Re-fetching with `--refresh`

When invoked with `--refresh`, `/doc-wiki:ingest` re-fetches a previously-ingested source instead of registering a new one. Two scope flags:

- `--source <s>`: re-fetch a single source matching `<s>` (URL, label, or path) against `<wikiRoot>/raw/index.json`.
- `--all`: re-fetch every source recorded in `<wikiRoot>/raw/index.json`.

The flow: read the source registry, re-run `gather()` against each entry, diff the new payload against `<wikiRoot>/raw/<source>/`, re-compile only changed pages, update indexes, log a `refresh` event per source. Supports checkpoint resume — interrupted batches can be re-run; only un-checked entries are retried.

`ingest <src>` (new source) and `ingest --refresh` (re-fetch) are mutually exclusive at the wrapper layer.
```

(If the previous refresh section contained additional details not summarized above, preserve them verbatim inside this subsection.)

- [ ] **Step 3: Delete the standalone `### /doc-wiki:refresh` section**

Find and delete everything from `### /doc-wiki:refresh — Re-fetch and update from original sources` up to (but not including) the next `### ` heading.

- [ ] **Step 4: Verify**

Run: `grep -n '^### /doc-wiki:' skills/doc-wiki/SKILL.md`

Expected: no `/doc-wiki:refresh` entry.

Run: `grep -c 'Re-fetching with \`--refresh\`' skills/doc-wiki/SKILL.md`

Expected: `1`.

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add skills/doc-wiki/SKILL.md
git commit -m "docs(doc-wiki): fold /doc-wiki:refresh into /doc-wiki:ingest --refresh"
```

---

## Task 4: Fold `promote` into `query` section in SKILL.md

**Files:**
- Modify: `skills/doc-wiki/SKILL.md` (query section ~lines 433-460; promote section ~lines 485-560; add three subsections to query, delete promote standalone)

- [ ] **Step 1: Read the current promote section**

```bash
START=$(grep -n '^### /doc-wiki:promote' skills/doc-wiki/SKILL.md | cut -d: -f1)
END=$(awk -v s="$START" 'NR>s && /^### / {print NR-1; exit}' skills/doc-wiki/SKILL.md)
sed -n "${START},${END}p" skills/doc-wiki/SKILL.md
```

Note the two existing modes — single (path/last/N/substring) and review — and their step-by-step flows.

- [ ] **Step 2: Append three subsections to the query section**

Find the end of `### /doc-wiki:query` (immediately before the next `### ` heading, which is `### /doc-wiki:lint`). Insert:

```markdown

#### Post-answer promote prompt (synthesis mode)

After rendering a synthesis-mode answer + citations, run `AskUserQuestion` "Save this answer as a permanent wiki page?". Gated by autonomy mode the same way other interactive prompts are (suppressed in non-interactive autonomy levels). Path mode skips this prompt. On "yes", run the single-promote flow below against the freshly-written archive in `outputs/queries/`.

#### `--promote <file|last|N>` — explicit promote of an archived answer

Resolves the target the same way the old `/doc-wiki:promote` single mode did:
- `last` / `latest` / `last query` / `latest query` → the most recent file in `outputs/queries/`
- integer `N` → the Nth most recent
- a path → as-is
- a single token → filename substring match
- empty → list-and-pick

(Reproduce the existing promote-single step list here verbatim — frontmatter generation, citation→link rewriting, topic placement, archive moved to `outputs/queries/.promoted/`, post-op hooks.)

#### `--review [--since <dur>] [--limit <N>] [--topic <dir>]` — bulk archive triage

(Reproduce the existing promote-review step list here verbatim — per-item P/S/D/A approval, autonomy gating, since/limit/topic filters.)
```

When reproducing the old flows, preserve them verbatim — do not rewrite. This is consolidation, not behavioral change.

- [ ] **Step 3: Delete the standalone `### /doc-wiki:promote` section**

Find and delete everything from `### /doc-wiki:promote — Query answer -> wiki page` up to (but not including) the next `### ` heading.

- [ ] **Step 4: Verify**

Run: `grep -n '^### /doc-wiki:' skills/doc-wiki/SKILL.md`

Expected: no `/doc-wiki:promote` entry.

Run: `grep -c 'Post-answer promote prompt\|--promote <file|last|N>\|--review \[--since' skills/doc-wiki/SKILL.md`

Expected: at least `3` (one per subsection — note the literal pipe in `<file|last|N>` requires the alternation in grep to be inside parens, so adjust the regex if needed; the count just needs to confirm all three subsections were inserted).

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add skills/doc-wiki/SKILL.md
git commit -m "docs(doc-wiki): fold /doc-wiki:promote into /doc-wiki:query"
```

---

## Task 5: Rename `fix` section to `edit` in SKILL.md

**Files:**
- Modify: `skills/doc-wiki/SKILL.md` (fix section ~lines 477-484; rename heading + body verbs; no behavioral change)

- [ ] **Step 1: Read the current fix section**

```bash
START=$(grep -n '^### /doc-wiki:fix' skills/doc-wiki/SKILL.md | cut -d: -f1)
END=$(awk -v s="$START" 'NR>s && /^### / {print NR-1; exit}' skills/doc-wiki/SKILL.md)
sed -n "${START},${END}p" skills/doc-wiki/SKILL.md
```

- [ ] **Step 2: Rename the section heading**

Edit `skills/doc-wiki/SKILL.md`. Find:
```
### /doc-wiki:fix — Quick corrections
```
Replace with:
```
### /doc-wiki:edit — Targeted page changes
```

- [ ] **Step 3: Update intro and body verbs from "fix" to "edit"**

Inside the section body, replace user-facing references to "fix" with "edit" / "change" / "modify" where they describe the user's intent. Internal references to file operations, "fixing" technical issues, etc. stay as-is (only change references that are about the command's purpose). Suggested edits inside the section:

- "Quick corrections" → "Targeted changes"
- "fix a wiki page" → "edit a wiki page"
- "what the issue is" → "what to change"
- The `Skill(doc-wiki, "fix ...")` invocation example → `Skill(doc-wiki, "edit ...")`

Read the section after your edits and confirm the user-facing language is consistent.

- [ ] **Step 4: Verify**

Run: `grep -n '^### /doc-wiki:' skills/doc-wiki/SKILL.md`

Expected: no `/doc-wiki:fix` entry; new `/doc-wiki:edit — Targeted page changes` entry present.

Run: `grep -n '/doc-wiki:fix' skills/doc-wiki/SKILL.md`

Expected: zero matches.

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add skills/doc-wiki/SKILL.md
git commit -m "docs(doc-wiki): rename /doc-wiki:fix to /doc-wiki:edit"
```

---

## Task 6: Update slash-command wrapper files

**Files:**
- Modify: `commands/init.md`, `commands/ingest.md`, `commands/query.md`
- Create: `commands/edit.md`
- Delete: `commands/onboard.md`, `commands/refresh.md`, `commands/promote.md`, `commands/fix.md`

- [ ] **Step 1: Update `commands/init.md`**

Replace the entire file contents with:

```markdown
---
description: Bootstrap a wiki — scaffold, onboard, optionally chain atlas
argument-hint: '[--path <wiki-root>] [--domain <domain>] [--name <wiki-name>] [--no-atlas | --atlas]'
allowed-tools: Skill(doc-wiki)
---

Invoke the `doc-wiki` skill to run the `/doc-wiki:init` workflow with the user's arguments: $ARGUMENTS

Call `Skill(doc-wiki, "init $ARGUMENTS")`. The skill orchestrator reads `skills/doc-wiki/SKILL.md`, locates the `### /doc-wiki:init — Bootstrap a wiki` section, and executes the four-phase flow: (1) detect existing state, (2) scaffold the wiki directory if needed, (3) run the onboarding Q&A (language/framework detect, ORM via wiki-orm-agent, DB via wiki-db-agent, ecosystem services Q&A, autonomy choice, hook install), (4) decide on atlas — if `--atlas` chain immediately; if `--no-atlas` stop; otherwise prompt the user.

If `$ARGUMENTS` is empty, do NOT pre-prompt — invoke the skill anyway. The skill's `/doc-wiki:init` section infers a default path of `docs/<app-name-kebab-case>-wiki/` from the project's marker file (`package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `pom.xml`, ...) and asks the user to confirm or override via a single `AskUserQuestion` prompt. Arg collection lives in the skill so default-inference logic stays co-located with the rest of the orchestrator.
```

- [ ] **Step 2: Update `commands/ingest.md`**

Replace the entire file contents with:

```markdown
---
description: Ingest a source — new source, or re-fetch with --refresh
argument-hint: '<source> [--wiki-root <path>] [--output <relative-path>] [--no-crosslink] [--no-tag-harmonize] | --refresh [--source <s> | --all]'
allowed-tools: Skill(doc-wiki)
---

Invoke the `doc-wiki` skill to run the `/doc-wiki:ingest` workflow with the user's arguments: $ARGUMENTS

Call `Skill(doc-wiki, "ingest $ARGUMENTS")`. The skill orchestrator reads `skills/doc-wiki/SKILL.md`, locates the `### /doc-wiki:ingest — Fetch + Extract + Compile` section, and dispatches one of two modes:

- **New-source mode** (default, when a positional source is given): runs the 13-step ingest pipeline (parse config, check cache, extract binary if needed, security-check URLs, read source fully, surface takeaways, cross-reference active agents, compile pages, auto-generate Mermaid, generate "How to Go Deeper", update indexes + summaries, log event, run post-op hooks).
- **Refresh mode** (when `--refresh` is present): re-fetches previously-ingested sources, diffs against stored versions, re-compiles changed pages. `--source <s>` scopes to one source; `--all` scopes to every entry in `<wikiRoot>/raw/index.json`. Supports checkpoint resume for interrupted batch refreshes.

The two modes are mutually exclusive — passing both a positional source and `--refresh` is an error.

If `$ARGUMENTS` is empty, ask the user for the source (file path, URL, folder, or pasted text) or confirm a default refresh.
```

- [ ] **Step 3: Update `commands/query.md`**

Replace the entire file contents with:

```markdown
---
description: Search + synthesize the wiki, find concept paths, or save query answers as wiki pages
argument-hint: '<question> | --from <a> --to <b> [--max-hops <N>] [--via <c>] [--all-paths] | --promote <file|last|N> | --review [--since <dur>] [--limit <N>] [--topic <dir>] [--wiki-root <path>]'
allowed-tools: Skill(doc-wiki)
---

Invoke the `doc-wiki` skill to run the `/doc-wiki:query` workflow with the user's arguments: $ARGUMENTS

Call `Skill(doc-wiki, "query $ARGUMENTS")`. The skill orchestrator reads `skills/doc-wiki/SKILL.md`, locates the `### /doc-wiki:query — Summary-first search + synthesis` section, and dispatches one of four modes:

- **Synthesis mode** (default): runs the summary-first flow — read `summaries.md`, score relevance, load top-N pages, follow links up to 5 levels, synthesize with citations, surface contradictions, archive to `outputs/queries/`, log token efficiency. After the answer, prompts "Save this answer as a permanent wiki page?" (gated by autonomy mode).
- **Path mode** (when `--from` and `--to` are present): shells out to `graph_ops.js path` against `<wiki-root>/graph/edges.jsonl` and returns the typed-edge chain connecting the two concepts. Skips summary-first scoring, link-following, synthesis, and the promote prompt.
- **Promote mode** (when `--promote <file|last|N>` is present): converts an archived answer in `outputs/queries/` into a wiki page (frontmatter, citation→link rewriting, topic placement). Argument forms: `last`/`latest` → most recent; integer `N` → Nth most recent; path → as-is; single token → filename substring match; empty → list-and-pick.
- **Review mode** (when `--review` is present): bulk archive triage with per-item P/S/D/A approval, honoring autonomy mode. Supports `--since <duration>`, `--limit <N>`, and `--topic <dir>` for filtering.

If `$ARGUMENTS` is empty, ask the user for the question they want to answer from the wiki (or for the two concepts to connect via path mode).
```

- [ ] **Step 4: Create `commands/edit.md`**

Run: `touch commands/edit.md` then write the following contents:

```markdown
---
description: Edit a wiki page — targeted change to a specific page
argument-hint: '<page-path> <change-description>'
allowed-tools: Skill(doc-wiki)
---

Invoke the `doc-wiki` skill to run the `/doc-wiki:edit` workflow with the user's arguments: $ARGUMENTS

Call `Skill(doc-wiki, "edit $ARGUMENTS")`. The skill orchestrator reads `skills/doc-wiki/SKILL.md`, locates the `### /doc-wiki:edit — Targeted page changes` section, and runs the page-modification flow (read the page, show diff of current vs proposed, apply if autonomy mode permits, log the event, and run post-op hooks for crosslink + tag-harmonize).

If `$ARGUMENTS` is empty, ask the user which page needs editing and what the change is.
```

- [ ] **Step 5: Delete the four removed wrappers**

Run:
```bash
rm commands/onboard.md commands/refresh.md commands/promote.md commands/fix.md
```

- [ ] **Step 6: Verify**

Run: `ls commands/`

Expected output (alphabetical):
```
atlas.md
edit.md
ingest.md
init.md
lint.md
query.md
stats.md
```

Run: `ls commands/ | wc -l`

Expected: `7`.

Run: `grep -l 'doc-wiki:fix\|doc-wiki:onboard\|doc-wiki:refresh\|doc-wiki:promote' commands/`

Expected: no matches (silent exit, no output).

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add commands/
git commit -m "feat(doc-wiki): consolidate slash-command wrappers from 10 to 7"
```

---

## Task 7: Update multi-platform config mirrors

**Files:**
- Modify: `AGENTS.md`, `GEMINI.md`, `.cursor/rules/doc-wiki.mdc`, `.aider/conventions.md`

These four files mirror `skills/doc-wiki/SKILL.md` for non-Claude-Code tools (Codex, Gemini, Cursor, Aider). Each needs the same description rewrite. The exact insertion point depends on each file's structure — read the file before editing.

- [ ] **Step 1: Capture current state**

Run: `for f in AGENTS.md GEMINI.md .cursor/rules/doc-wiki.mdc .aider/conventions.md; do echo "=== $f ==="; head -5 "$f" 2>/dev/null || echo "(missing)"; done`

Note for each file: does it have a YAML frontmatter? Does it reference the 10-command count? Does it list specific old command names (`onboard`, `refresh`, `promote`, `fix`)?

- [ ] **Step 2: Update `AGENTS.md`**

Locate any sentence that lists the doc-wiki commands or describes the skill's purpose. Update it to mirror the new SKILL.md description (the same one used in Task 1, Step 2). Specifically:

- Replace any reference to "10 slash commands" with "7 slash commands".
- Replace the command list `init, onboard, atlas, ingest, query, lint, fix, promote, refresh, stats` with `init, atlas, ingest, query, lint, edit, stats`.
- Replace any phrasing that describes the skill's trigger surface with the new description's pushy/triggering language.

Read the file fully before editing; make targeted edits that preserve file-specific content unrelated to the doc-wiki commands.

- [ ] **Step 3: Update `GEMINI.md`**

Same treatment as Step 2 — update command count, command list, and trigger description to match the new SKILL.md.

- [ ] **Step 4: Update `.cursor/rules/doc-wiki.mdc`**

Same treatment. Cursor `.mdc` files often have frontmatter with a `description:` field; update it the same way as Task 1, Step 2.

- [ ] **Step 5: Update `.aider/conventions.md`**

Same treatment.

- [ ] **Step 6: Verify**

Run: `grep -l 'doc-wiki:fix\|doc-wiki:onboard\|doc-wiki:refresh\|doc-wiki:promote' AGENTS.md GEMINI.md .cursor/rules/doc-wiki.mdc .aider/conventions.md 2>/dev/null`

Expected: no matches.

Run: `grep -c '10 slash\|10 thin wrappers\|10 wrappers' AGENTS.md GEMINI.md .cursor/rules/doc-wiki.mdc .aider/conventions.md 2>/dev/null`

Expected: each file reports `0`.

- [ ] **Step 7: Commit**

```bash
git add AGENTS.md GEMINI.md .cursor/rules/doc-wiki.mdc .aider/conventions.md
git commit -m "docs(doc-wiki): mirror new SKILL description in AGENTS/GEMINI/cursor/aider configs"
```

---

## Task 8: Update project-root `CLAUDE.md`

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Capture current relevant lines**

Run: `grep -n '(10)\|10 thin wrappers\|onboard\|refresh\|fix\|promote' CLAUDE.md | head -30`

You should see at least these locations (line numbers may vary):
- "Slash-command wrappers: `commands/doc-wiki:*.md` — 10 thin wrappers..."
- "### Slash commands (10) — `commands/`"
- The file list: `init.md`, `onboard.md`, `atlas.md`, `ingest.md`, `query.md`, `lint.md`, `fix.md`, `promote.md`, `refresh.md`, `stats.md`
- The Quickstart block showing `/doc-wiki:init`, `/doc-wiki:onboard`, `/doc-wiki:ingest`

- [ ] **Step 2: Replace the "10 thin wrappers" sentence**

Find and replace:
```
**Slash-command wrappers:** `commands/doc-wiki:*.md` — 10 thin wrappers so `/doc-wiki:init`, `/doc-wiki:onboard`, `/doc-wiki:atlas`, etc. appear in Claude Code's slash-command autocomplete and route into the skill
```
With:
```
**Slash-command wrappers:** `commands/*.md` — 7 thin wrappers so `/doc-wiki:init`, `/doc-wiki:atlas`, `/doc-wiki:ingest`, `/doc-wiki:query`, `/doc-wiki:lint`, `/doc-wiki:edit`, `/doc-wiki:stats` appear in Claude Code's slash-command autocomplete and route into the skill
```

- [ ] **Step 3: Replace the "### Slash commands (10)" heading**

Find:
```
### Slash commands (10) — `commands/`
```
Replace with:
```
### Slash commands (7) — `commands/`
```

- [ ] **Step 4: Replace the file list paragraph**

Find the sentence listing all 10 wrapper filenames and replace the file list portion:
```
Files: `init.md`, `onboard.md`, `atlas.md`, `ingest.md`, `query.md`, `lint.md`, `fix.md`, `promote.md`, `refresh.md`, `stats.md`.
```
With:
```
Files: `init.md`, `atlas.md`, `ingest.md`, `query.md`, `lint.md`, `edit.md`, `stats.md`.
```

(The surrounding sentence describing what each wrapper does should be updated to drop references to onboard, refresh, promote, fix and mention that `init` now does setup-plus-optional-atlas, `ingest` includes `--refresh`, `query` includes `--promote`/`--review`, and `edit` replaces the old `fix`.)

- [ ] **Step 5: Update the Quickstart block**

Find the Quickstart code block (around the top of the file under `## Quickstart`):
```
/doc-wiki:init         # scaffold wiki/ + wiki.config.yaml
/doc-wiki:onboard      # detect stack, ORM, DB; set up ~/.connectors/config.yaml
/doc-wiki:ingest <src> # fetch a source, compile, link, diagram, index
```

Replace with:
```
/doc-wiki:init         # scaffold + onboard + (optionally) chain /doc-wiki:atlas
/doc-wiki:ingest <src> # fetch a source, compile, link, diagram, index
/doc-wiki:query <q>    # search the wiki, optionally save the answer as a page
```

Update the explanatory paragraph below the block accordingly — the separate "onboard" step is gone.

- [ ] **Step 6: Verify**

Run: `grep -n 'doc-wiki:fix\|doc-wiki:onboard\|doc-wiki:refresh\|doc-wiki:promote' CLAUDE.md`

Expected: zero matches.

Run: `grep -n '(10)\|10 thin wrappers' CLAUDE.md`

Expected: zero matches.

Run: `grep -n '(7)' CLAUDE.md`

Expected: at least one match (the "Slash commands (7)" heading).

- [ ] **Step 7: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(doc-wiki): update CLAUDE.md for 7-command surface"
```

---

## Task 9: Update user-facing docs

**Files:**
- Modify: `README.md`, `docs/commands.md`, `docs/getting-started.md`, `docs/atlas.md`, `docs/troubleshooting.md`

- [ ] **Step 1: Update `README.md` Quickstart**

Run: `grep -n '/doc-wiki:onboard\|/doc-wiki:fix\|/doc-wiki:refresh\|/doc-wiki:promote' README.md`

For each match, decide whether the surrounding text needs full rewriting or just replacement:
- Any line invoking `/doc-wiki:onboard` as a separate step should be removed; the surrounding paragraph should explain that `/doc-wiki:init` does both.
- Any line invoking `/doc-wiki:refresh` should become `/doc-wiki:ingest --refresh`.
- Any line invoking `/doc-wiki:promote` should become `/doc-wiki:query --promote` (or be reframed as part of the post-answer prompt flow).
- Any line invoking `/doc-wiki:fix` should become `/doc-wiki:edit`.

If the README has a "Commands" or "Usage" section listing all wrappers, update it to list the 7 new commands.

- [ ] **Step 2: Rewrite `docs/commands.md`**

Read the current `docs/commands.md`:
```bash
wc -l docs/commands.md
head -40 docs/commands.md
```

This file documents each command in detail. Rewrite it so it has exactly 7 sections — one per surviving command. For each section:
- One-paragraph description matching the SKILL.md section's intent
- Argument table
- Example invocation

Then add a **`## Removed commands` section at the bottom** that documents the migration:

```markdown
## Removed commands

The following commands existed in earlier versions and have been consolidated into the seven surviving commands. Their behavior is fully reachable via the new surface; only the entry point changed.

| Removed | New invocation | Why |
|---|---|---|
| `/doc-wiki:onboard` | `/doc-wiki:init` (re-runs onboarding on initialized wikis after confirmation) | The two commands shared the first-run flow; merging them eliminates a step. |
| `/doc-wiki:refresh` | `/doc-wiki:ingest --refresh [--source <s> \| --all]` | Refresh is "re-run ingest on prior sources" — folded into ingest as a mode. |
| `/doc-wiki:promote <file>` | `/doc-wiki:query --promote <file>` (or accept the post-answer prompt after a synthesis query) | Promote is a follow-up workflow on query archives — folded into query. |
| `/doc-wiki:promote --review` | `/doc-wiki:query --review` | Same — bulk triage of query archives. |
| `/doc-wiki:fix <page> "<issue>"` | `/doc-wiki:edit <page> "<change>"` | Renamed because the command modifies a page for any reason, not only to fix broken state. |
```

- [ ] **Step 3: Update `docs/getting-started.md`**

Run: `grep -n '/doc-wiki:onboard\|/doc-wiki:fix\|/doc-wiki:refresh\|/doc-wiki:promote' docs/getting-started.md`

Replace any walkthrough that uses two commands for first-run (`init` then `onboard`) with a single-command flow that ends at the atlas prompt. Drop the separate "Onboarding" step header if present; merge that content into the "Initialization" step.

- [ ] **Step 4: Update `docs/atlas.md`**

Add a short paragraph near the top (under any "How to invoke atlas" or "Entry points" section) noting:

> Atlas can be invoked directly via `/doc-wiki:atlas`, or implicitly via the post-onboarding prompt at the end of `/doc-wiki:init` — the recommended first-run entry point for new wikis.

If the file doesn't have an obvious place for this, append it under the introduction.

- [ ] **Step 5: Update `docs/troubleshooting.md`**

Append a new `## Migration: where did <old command> go?` section at the bottom (or insert in the existing FAQ structure if one exists):

```markdown
## Migration: where did `<old command>` go?

### `/doc-wiki:onboard`

Folded into `/doc-wiki:init`. On a wiki that's already initialized, re-running `/doc-wiki:init` prompts "Wiki already initialized. Re-run onboarding?" — choose yes to re-run the same flow the old `/doc-wiki:onboard` ran.

### `/doc-wiki:refresh`

Folded into `/doc-wiki:ingest --refresh [--source <s> | --all]`. `--source <s>` re-fetches a single previously-ingested source; `--all` re-fetches every source in `<wikiRoot>/raw/index.json`.

### `/doc-wiki:promote`

Folded into `/doc-wiki:query`:
- Single-file promote: `/doc-wiki:query --promote <file|last|N>`. After a synthesis-mode `/doc-wiki:query` answers your question, you're also prompted "Save this answer as a permanent wiki page?" — accepting that prompt runs the same promote flow on the just-written archive.
- Bulk review: `/doc-wiki:query --review [--since <dur>] [--limit <N>] [--topic <dir>]`.

### `/doc-wiki:fix`

Renamed to `/doc-wiki:edit`. The behavior is identical — the name was changed because the command modifies a page for any reason (not just fixing broken state), and the old name collided semantically with `/doc-wiki:lint`'s auto-heal mode.
```

- [ ] **Step 6: Verify**

Run: `grep -rn 'doc-wiki:fix\|doc-wiki:onboard\|doc-wiki:refresh\|doc-wiki:promote' README.md docs/ | grep -v 'doc-wiki:fix.*→\|doc-wiki:onboard.*→\|doc-wiki:refresh.*→\|doc-wiki:promote.*→\|Removed\|Migration\|where did\|backtick.*doc-wiki'`

Expected: zero matches (or only matches inside `Removed commands` / `Migration` sections, which is intentional).

If non-migration references remain, fix them now.

- [ ] **Step 7: Commit**

```bash
git add README.md docs/commands.md docs/getting-started.md docs/atlas.md docs/troubleshooting.md
git commit -m "docs(doc-wiki): update user-facing docs for 7-command surface"
```

---

## Task 10: Final verification and stragglers

**Files:** none modified in this task unless verification surfaces issues.

- [ ] **Step 1: Repo-wide grep for stale command references**

Run:
```bash
git grep -nE '/doc-wiki:(fix|onboard|refresh|promote)' -- ':(exclude)docs/superpowers/' ':(exclude)docs/commands.md' ':(exclude)docs/troubleshooting.md'
```

Expected: zero matches outside the spec/plan/migration-doc allowlist.

If matches appear, fix them in the relevant files and append the fixes to the current commit or create a follow-up commit titled `docs(doc-wiki): clean up stale command references missed in earlier pass`.

- [ ] **Step 2: Confirm wrapper directory inventory**

Run: `ls commands/ | sort`

Expected (alphabetical, 7 entries):
```
atlas.md
edit.md
ingest.md
init.md
lint.md
query.md
stats.md
```

- [ ] **Step 3: Confirm SKILL.md section inventory**

Run: `grep -n '^### /doc-wiki:' skills/doc-wiki/SKILL.md`

Expected: exactly 7 entries — `init`, `atlas`, `ingest`, `query`, `lint`, `edit`, `stats` (in source order; the actual order in the file depends on prior content layout).

- [ ] **Step 4: Confirm SKILL.md description length**

Run: `awk '/^---$/{c++;next} c==1 && /^description:/ { sub(/^description: /, ""); print length($0) }' skills/doc-wiki/SKILL.md`

Expected: a single number between 800 and 1024.

- [ ] **Step 5: Run the full test suite**

Run: `npm test`

Expected: `1130 passed | 5 skipped` (or whatever the current baseline is). The simplification touches no testable logic, so the suite must remain green.

If any tests fail, the failure is unrelated to this work and should be triaged separately — DO NOT proceed with claiming completion until tests are green.

- [ ] **Step 6: Run the typecheck**

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 7: Print the final commit summary**

Run:
```bash
git log --oneline main..HEAD
```

Expected: 9 commits (Tasks 1-5 each commit once on `skills/doc-wiki/SKILL.md`; Task 6 commits the wrapper changes; Task 7 commits the multi-platform mirrors; Task 8 commits CLAUDE.md; Task 9 commits user-facing docs). Confirm each commit message starts with `docs(doc-wiki):` or `feat(doc-wiki):`.

- [ ] **Step 8: Manual smoke test (interactive)**

Open Claude Code and type `/doc-wiki:` in the prompt. The autocomplete dropdown should show exactly seven entries: `init`, `atlas`, `ingest`, `query`, `lint`, `edit`, `stats`. Verify none of the removed commands (`onboard`, `refresh`, `promote`, `fix`) appear.

If the dropdown still shows old commands, the wrapper files weren't deleted correctly. Run `ls commands/` to confirm.

- [ ] **Step 9: Final commit (only if needed)**

If Task 10 surfaced any straggler fixes, commit them now:
```bash
git add -p   # interactively select straggler fixes
git commit -m "docs(doc-wiki): clean up stragglers after command simplification"
```

Otherwise, nothing to commit — the work from Tasks 1-9 stands as-is.
