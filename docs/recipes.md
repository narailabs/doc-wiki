# Recipes

Common end-to-end workflows. Each recipe is a self-contained command sequence with the expected outcome and pointers to the deeper docs. Pick the closest match to what you're doing — they're independent, no need to read top-to-bottom.

| # | Recipe | When to use |
|---|---|---|
| 1 | [First-time setup on a new repo](#1-first-time-setup-on-a-new-repo) | You just installed doc-wiki and want a working wiki |
| 2 | [Document an entire codebase in one pass](#2-document-an-entire-codebase-in-one-pass) | Existing project, want comprehensive coverage fast |
| 3 | [Grow the wiki by feedback loop](#3-grow-the-wiki-by-feedback-loop) | Daily-driver pattern — let questions reveal gaps |
| 4 | [Weekly maintenance](#4-weekly-maintenance) | Keep an established wiki fresh and healthy |
| 5 | [Add a new external service mid-stream](#5-add-a-new-external-service-mid-stream) | Wire up Jira / GitHub / etc. after the wiki is already running |
| 6 | [Multi-source ingest of one feature](#6-multi-source-ingest-of-one-feature) | Cross-link code + ticket + design doc into one page |
| 7 | [Recover from an interrupted run](#7-recover-from-an-interrupted-run) | Ctrl-C'd `/doc-wiki:atlas` or a folder ingest |
| 8 | [Sync `CLAUDE.md` after a refactor](#8-sync-claudemd-after-a-refactor) | Project-memory file drifted from the code |

---

## 1. First-time setup on a new repo

You just installed the plugin (see [`getting-started.md`](getting-started.md) for install). You want a working wiki with one or two pages.

```text
/doc-wiki:init
/doc-wiki:ingest README.md
/doc-wiki:query "what does this project do?"
```

**What you get:**

- `wiki.config.yaml` populated with detected language, ORM, and DB (set up during `/doc-wiki:init` Phase 3 — Onboarding).
- `~/.connectors/config.yaml` bootstrapped if you said yes to any external service in onboarding's six questions.
- One compiled wiki page under `wiki/` with frontmatter, narrative, optional Mermaid diagrams, and a "How to Go Deeper" section.
- An archived `/doc-wiki:query` answer under `wiki/outputs/queries/`.

**See also:** [`getting-started.md`](getting-started.md) for the same flow with screenshots-of-output and explanations per step.

---

## 2. Document an entire codebase in one pass

You have an existing app (10–500 source files) and want comprehensive coverage in one shot rather than incrementally.

```text
/doc-wiki:atlas --dry-run            # see the plan + cost estimate, no writes
/doc-wiki:atlas                      # commit; default --max-cost is $200
/doc-wiki:query "give me an architecture overview"
```

**What atlas does:** discovers topics from five signals (top-level code dirs, ORM domains, existing wiki dirs, gitlog churn, CLI commands), batches `/doc-wiki:ingest` per `(topic × facet)` pair, then synthesizes 3–7 global pages (`overview.md`, `integrations.md`, `deploy.md`, plus `commands.md` / `getting-started.md` / `configuration.md` / `troubleshooting.md` when relevant).

**Useful flags:**

- `--facets architecture,data-model` — only those facets per topic. Re-runs are **additive** — never deletes facets from prior wider runs.
- `--scope auth` — restrict to one topic (incremental).
- `--max-cost 50` — abort pre-write if the estimate exceeds.
- `--validate-mode full` — on a re-run, semantically check every existing atlas page against current source (cached on `(page-hash, source-hash)`).

**See also:** [`atlas.md`](atlas.md) for the eight-phase walkthrough.

---

## 3. Grow the wiki by feedback loop

The "wikis grow by use, not by upfront planning" pattern. Treat coverage gaps as something queries reveal.

```text
/doc-wiki:query "how does the rate limiter handle bursts?"
# (the answer surfaces a gap — maybe one page is light)
/doc-wiki:query --promote last --topic infra
# (next time you ask a related question, the wiki has it)
/doc-wiki:query "what happens when the rate limit is exhausted?"
```

**Why it works:** every `/doc-wiki:query` is archived under `wiki/outputs/queries/<timestamp>.md`. `/doc-wiki:query --promote` converts the most recent (or any specific archive) into a permanent wiki page, places it under `wiki/<topic>/<slug>.md`, updates indexes, and runs the post-op crosslink + tag-harmonize hooks so it links to existing pages.

**Variant — bulk triage** when archives have piled up:

```text
/doc-wiki:query --review --since 7d
```

Walks every archive from the last week, asks `[P]romote / [S]kip / [D]elete / [A]bort`. Already-covered insights are auto-skipped under `balanced` autonomy.

**See also:** [`commands.md` § /doc-wiki:query promote mode](commands.md#promote-mode).

---

## 4. Weekly maintenance

Keep a mature wiki fresh: re-fetch upstream sources, heal structural drift, triage accumulated queries, sanity-check spend.

```text
/doc-wiki:ingest --refresh --all
/doc-wiki:lint --fix
/doc-wiki:query --review --since 7d
/doc-wiki:stats --since 7d --per-agent
```

**What each does:**

- `ingest --refresh --all` — reads `log/events.jsonl`, re-fetches every previously ingested source through the same connector, recomputes content hashes, recompiles only the pages whose source changed.
- `lint --fix` — runs broken-link / missing-frontmatter / orphan / code-ref-drift / provenance-gap checks; applies safe auto-fixes per your autonomy mode.
- `query --review --since 7d` — bulk-triage one week of archived queries.
- `stats --since 7d --per-agent` — total tokens, p50/p95 reduction ratios, total spend, per-agent breakdown including connector calls.

**Run unattended** (when you have the `/schedule` skill):

```text
/schedule "Run /doc-wiki:ingest --refresh --all && /doc-wiki:lint --fix" "every Monday at 9am"
```

For unattended runs, set `autonomy.mode: auto` in `wiki.config.yaml` so prompts are skipped.

**See also:** [`commands.md`](commands.md), [`autonomy-modes.md`](autonomy-modes.md) for unattended-mode tradeoffs.

---

## 5. Add a new external service mid-stream

Wiki has been running on local files only; now you want to pull Jira tickets too.

```sh
# Edit ~/.connectors/config.yaml:
#   uncomment the jira block, set server_url / email / api_token to env: refs.
$ vim ~/.connectors/config.yaml

# Set the env vars in your shell rc:
$ export JIRA_SERVER_URL=https://your-org.atlassian.net
$ export JIRA_EMAIL=you@your-org.com
$ export JIRA_API_TOKEN=ATATT3xx...
```

Then in Claude Code:

```text
/doc-wiki:ingest https://your-org.atlassian.net/browse/AUTH-123
```

The hub planner now sees `jira` is enabled, dispatches to it on the URL, and the resulting envelope is decorated with a Mermaid diagram (Jira-issue shape) and compiled into a wiki page.

**Quicker: re-run onboarding.** `/doc-wiki:init` is idempotent. Re-running on an initialized wiki prompts "Wiki already initialized. Re-run onboarding?" — answer yes, then answer "yes" to Jira when asked; it'll add the block for you and prompt for credential refs.

```text
/doc-wiki:init
```

**See also:** [`connectors.md`](connectors.md), [`configuration.md`](configuration.md).

---

## 6. Multi-source ingest of one feature

You want one wiki page that reflects code + the ticket that spec'd it + the Confluence design doc behind that ticket.

```text
/doc-wiki:ingest src/auth/
/doc-wiki:ingest https://your-org.atlassian.net/browse/AUTH-123
/doc-wiki:ingest https://your-org.atlassian.net/wiki/spaces/ENG/pages/12345/Auth+Design
/doc-wiki:query "how is JWT validation wired up, and what was the original design intent?"
```

Each `/doc-wiki:ingest` produces a separate compiled page. The crosslink post-hook (runs once you have ≥3 pages) links them by overlapping entities — JWT, refresh tokens, session model — so the final `/doc-wiki:query` synthesizes from all three sources with citations.

**Useful follow-up:**

```text
/doc-wiki:query --promote last --topic auth
```

Promotes the cross-source synthesis into a permanent page that any future query can build on.

**See also:** [`connectors.md`](connectors.md) for which URL shapes route to which connector.

---

## 7. Recover from an interrupted run

You hit Ctrl-C, lost connection, or the laptop slept mid-run.

**For `/doc-wiki:atlas`:**

```text
/doc-wiki:atlas --resume
```

Reads `wiki/outputs/atlas/<latest-run-id>/plan.json` and picks up at the first Phase 6 entry whose page wasn't committed. Re-discovery is suppressed — the saved plan is the contract, gitlog churn arriving between attempts does not expand scope.

**For folder ingest** (`/doc-wiki:ingest src/`):

```text
/doc-wiki:ingest src/
```

Re-running the same command picks up where the checkpoint stopped. The SHA256 cache also auto-skips already-compiled files.

**Inspect the checkpoint** if you're unsure what state you're in:

```sh
$ cat wiki/.wiki-checkpoint.json
```

**See also:** [`atlas.md` § Resuming a partial run](atlas.md#resuming-a-partial-run).

---

## 8. Sync `CLAUDE.md` after a refactor

You moved or renamed major code, and the project-root `CLAUDE.md` (loaded by Claude Code on every session) still describes the old layout.

```text
# Re-ingest the affected areas first so the wiki reflects current state.
/doc-wiki:ingest src/                # or just the changed subdirs
/doc-wiki:lint --fix                 # heal code-ref drift

# Then regenerate the managed sections of CLAUDE.md from the wiki.
# (The wiki-claude-md-agent owns "wiki-managed" sections inside CLAUDE.md;
#  hand-edited content outside those markers is preserved.)
```

The `wiki-claude-md-agent` is invoked by the orchestrator skill on demand. There's no dedicated slash command — typically you ask Claude in the session: "Run the claude-md agent to refresh the wiki-managed sections in CLAUDE.md."

The agent:
1. Reads the wiki's current state.
2. Generates an updated architecture summary, script inventory, and agent inventory.
3. Splices into `CLAUDE.md` between `<!-- wiki-managed: <section> start/end -->` markers.
4. Leaves anything outside those markers untouched (your hand-written prose, project-specific guidelines).

**Submodule support:** if the repo has nested `CLAUDE.md` files, the agent updates them too with parent/child cross-links.

**See also:** [`agents/wiki-claude-md-agent/AGENT.md`](../agents/wiki-claude-md-agent/AGENT.md) for the spec, [`internals/architecture.md`](internals/architecture.md) for where the agent fits in the three-layer model.

---

## Where to next

- [`commands.md`](commands.md) — every `/doc-wiki:*` command with full args reference.
- [`atlas.md`](atlas.md) — the eight-phase atlas pipeline.
- [`autonomy-modes.md`](autonomy-modes.md) — when to pick conservative / balanced / autonomous / auto.
- [`troubleshooting.md`](troubleshooting.md) — diagnostics for common failures.
