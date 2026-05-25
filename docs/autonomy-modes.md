# Autonomy modes

doc-wiki commands that mutate the wiki — `/doc-wiki:ingest`, `/doc-wiki:lint --fix`, `/doc-wiki:edit`, `/doc-wiki:query --promote`, `/doc-wiki:atlas` — gate their changes through an **autonomy mode**. The mode controls when doc-wiki applies a change automatically, when it shows you a diff and asks first, and when it routes a finding to the human-review audit inbox.

This doc is the operator-facing guide to picking the right mode and tuning it per category. For the full decision flow used by the orchestrator skill, see [`../skills/doc-wiki/references/autonomy.md`](../skills/doc-wiki/references/autonomy.md).

## Table of contents

- [The four modes at a glance](#the-four-modes-at-a-glance)
- [When to pick which](#when-to-pick-which)
- [Issue categories](#issue-categories)
- [Per-category overrides](#per-category-overrides)
- [The audit inbox](#the-audit-inbox)
- [Changing modes](#changing-modes)

## The four modes at a glance

| Mode | Structural fixes | Content suggestions | Disputes / contradictions |
|---|---|---|---|
| `conservative` | Ask before applying | Ask before applying | Always to audit inbox |
| `balanced` (default) | Auto-apply | Show diff, ask | To audit inbox |
| `autonomous` | Auto-apply | Auto-apply | To audit inbox |
| `auto` | Auto-apply | Skip (no user present) | To audit inbox |

**Common across all modes:** every action is logged to `log/events.jsonl` regardless of mode. **Disputes and contradictions** always file to `audit/open/` — no mode auto-resolves a factual contradiction. The audit inbox is the safety valve.

## When to pick which

### `conservative`

- First time using doc-wiki on a sensitive or high-stakes wiki (legal, compliance, customer-facing docs).
- Multi-author wikis where teammates haven't agreed on conventions yet — every fix is a teaching moment.
- Brand-new wikis where you want to see what doc-wiki *would* do before letting it do it.

Trade-off: lots of `[Y/n]` prompts. Productive after a few sessions when you've internalized which fixes are safe.

### `balanced` (default — pick this if unsure)

- Daily-driver mode. The wiki is yours, you trust the lint rules, but you want a heads-up before content rewrites.
- Auto-fixes the deterministic stuff (broken links, missing frontmatter, missing summaries) without bothering you.
- Shows a diff and asks before applying anything that requires judgment (rephrasing, claim merges, terminology changes).

Trade-off: occasional prompts during otherwise hands-off operations like atlas.

### `autonomous`

- Single-author wikis where you trust your own setup and don't need to gate every content change.
- Established wikis with a stable lint configuration where the rules have proven correct over time.
- Heavy `/doc-wiki:lint --fix` users who are tired of confirming obviously-correct content fixes.

Trade-off: less visibility into what changed. Mitigate by reviewing `log/events.jsonl` periodically — `/doc-wiki:stats --since 7d` summarizes recent activity.

### `auto`

- CI / scheduled / batch contexts. No user is present to answer prompts, so any "ask user" decision is **skipped** rather than blocked.
- Unattended `/doc-wiki:atlas` runs (`--yes` flag has the same effect for the phase 3 confirmation only; `auto` mode generalizes to every gate).
- Pre-merge GitHub Actions that run `/doc-wiki:ingest --refresh --all && /doc-wiki:lint --fix` to surface drift.

Trade-off: content suggestions are dropped silently (since there's no one to ask) — review `log/events.jsonl` after the run to see what was skipped vs what was applied.

## Issue categories

The autonomy mode applies different rules to different categories of finding:

### Structural (deterministic, auto-fixable)

These have a single correct answer, so most modes auto-apply:

- `broken_links` — link to a page that doesn't exist; auto-resolve if a single rename target is unambiguous.
- `missing_frontmatter` — page missing `title`, `type`, `tags`, or another required field.
- `orphan_pages` — no inbound or outbound edges.
- `index_coverage` — page absent from `wiki/index.md`.
- `summaries_sync` — page summary missing from `wiki/summaries.md`.

In `conservative` mode, even these get `[Y/n]` prompts.

### Content (requires judgment)

These involve rephrasing or claim-level changes; `balanced` shows a diff and asks first:

- `contradictions` — two pages disagree on a factual claim (this also files to audit inbox; see below).
- `stale_content` — page is >90 days old or its sources have drifted.
- `terminology_consistency` — same concept named different things in different pages.
- `missing_coverage` — a topic mentioned in one page but never explained.
- `under_linked_concepts` — a concept appears in many pages but has no canonical definition page.

In `auto` mode, these are **skipped silently** — no user present to ask.

### Disputes (always to audit inbox)

Two specific cases route to `audit/open/` regardless of mode:

- Factual contradictions between pages (caught by the contradictions check).
- Conflicting claims with evidence on both sides.

Resolution requires a human read; no mode auto-resolves these. See [the audit inbox](#the-audit-inbox) section below.

## Per-category overrides

Override the mode's default for specific issue types in `wiki.config.yaml`:

```yaml
autonomy:
  mode: balanced
  overrides:
    broken_links: auto_fix          # always auto-fix, even in conservative mode
    missing_frontmatter: auto_fix
    contradictions: human_review    # always ask, even in autonomous mode
    stale_content: suggest          # show diff, ask
```

Override values:

| Value | Behavior |
|---|---|
| `auto_fix` | Always apply automatically, regardless of mode |
| `suggest` | Always show diff and ask, regardless of mode |
| `human_review` | Always route to audit inbox; never auto-apply |

Useful patterns:

- **Tighten for sensitive categories.** In `autonomous` mode, override `contradictions: human_review` to make sure factual conflicts always get human eyes.
- **Loosen for noisy ones.** In `conservative` mode, override `broken_links: auto_fix` so renames don't trigger a prompt for every inbound link.

## The audit inbox

Disputes and `human_review` items land at `<wiki-root>/audit/open/<id>.md`:

```yaml
---
target: wiki/ml/transformers.md
severity: warn
category: contradiction
status: open
detected_by: lint
---
This page claims attention is O(n²) but billing/cost-model.md says
O(n·d) where d is the embedding dimension. Reconcile.
```

Each file is a markdown doc with frontmatter (target, severity, category) and a description of what needs human attention. Once you've decided, `mv` the file from `audit/open/` to `audit/resolved/` (or use a pre-built resolution flow if your environment has one).

`audit/` is a good thing to commit to git on team wikis — open disputes show up in code review and get triaged.

## Changing modes

Edit `wiki.config.yaml`:

```yaml
autonomy:
  mode: autonomous   # was: balanced
```

Takes effect on the next `/doc-wiki:*` command — no restart needed. The orchestrator re-reads `wiki.config.yaml` at the start of every command.

To change mode for one command only, most commands accept the flags that maximize automation: `/doc-wiki:atlas --yes` (skip Phase 3 confirmation), `/doc-wiki:lint --fix` (apply auto-fix). For repeated unattended runs, prefer setting `mode: auto` once.

## See also

- [`configuration.md` § autonomy](configuration.md#autonomy-section) — the YAML schema.
- [`commands.md` § /doc-wiki:lint](commands.md#doc-wikilint--health-check-and-auto-heal) — the main consumer of autonomy mode.
- [`commands.md` § /doc-wiki:query --review](commands.md#review-mode) — another mode-aware command.
- [`../skills/doc-wiki/references/autonomy.md`](../skills/doc-wiki/references/autonomy.md) — the orchestrator skill's full decision flow.
