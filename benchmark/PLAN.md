# doc-wiki benchmark — methodology & repo picks

> **Superseded (2026-06-10).** The V1 harness and its published runs were withdrawn: sessions ran with unrestricted network access, several curated ticket bodies contained root-cause analysis, and there were no training-data contamination controls. The V2 harness (container isolation, Anthropic-only egress firewall, sanitized tickets, pre-registered calibration) replaces it — see [`docs/superpowers/specs/2026-06-10-benchmark-harness-design.md`](../docs/superpowers/specs/2026-06-10-benchmark-harness-design.md). The curated 25-issue manifest in [`repos.yaml`](repos.yaml) remains valid input and will be re-used (re-sanitized + calibrated) for the V2 django/cal.com/mastodon phase.

> **Status: draft / V1.** Methodology and repo picks below are an opening proposal. Fill in `repos.yaml` with 20 curated issues per repo before launching the benchmark for real.

## Goal

Quantify how much `doc-wiki` improves Claude Code's autonomous ticket-fix accuracy. The headline number must be **reproducible by a hostile reviewer** in under an hour. That requirement shapes every choice below.

## Repo picks (proposed)

Three mid-sized, recognizable OSS codebases — one per major ecosystem, each exercising a different doc-wiki ORM profile:

| Repo | Stack | ORM | Why it's in |
|---|---|---|---|
| [django/django](https://github.com/django/django) | Python | Django | Large, well-issued, exercises Django ORM profile; canonical Python web framework |
| [calcom/cal.com](https://github.com/calcom/cal.com) | TypeScript / Next.js monorepo | Prisma | Modern enterprise-shape SaaS; exercises Prisma profile + multi-package complexity |
| [mastodon/mastodon](https://github.com/mastodon/mastodon) | Ruby on Rails | ActiveRecord | Different ecosystem; exercises ActiveRecord profile; mature with strong issue history |

Each represents a distinct ORM × language × app-shape combo so doc-wiki's coverage gets exercised, not just the easy cases. **Open question 1:** swap any of these? Alternates: Flask (smaller / cleaner than Django), Express (cleaner / smaller than Cal.com), Plane (more enterprise-app feel than Mastodon).

## Success criterion (SWE-bench-style)

For each issue:
1. Identify the merged PR that closed it.
2. Checkout the **parent commit** of that PR's merge commit (= state of code before the fix).
3. Hand Claude Code the issue title + body as a prompt.
4. Let it edit; cap turns at 30 and per-run cost at $20.
5. Run the **specific test added or modified by the fix PR** (`test_path` in `repos.yaml`).
6. **Success = that test passes.** No partial credit. No LLM-judge.

This matches [SWE-bench Verified](https://www.swebench.com/) methodology, which is the only reproducible game in town. Pre-existing test regressions are recorded but not part of the success metric.

## Issue selection

20 per repo. Filter:
- Merged PR in the last 18 months (deps still installable).
- PR closes a linked issue.
- PR diff ≤ 500 LOC.
- PR adds or modifies at least one test in the standard test path.
- Mix: ~70% bug fixes, ~30% small features (matches enterprise ticket distribution).

V1: curated by hand into `repos.yaml`. V2 can automate selection via `gh` + filters.

## Conditions

Two per (repo, issue):
- **baseline** — fresh clone, no doc-wiki. Claude Code reads only the repo's own files + its `CLAUDE.md` if present.
- **with-docwiki** — fresh clone, run `/doc-wiki:atlas --max-cost=50` first to build the wiki, then run the same issue prompt. Same model, same max-turns, same prompt.

## Model & cost

- **Model: `claude-sonnet-4-6`** for the primary run (cost/quality balance, matches what most Claude Code users have).
- **Optional secondary: `claude-opus-4-7`** to show the ceiling. Same harness, separate result column.
- **Cost ceiling: $1000 total, $20/run hard cap.**
- Expected cost: 3 repos × 20 issues × 2 conditions = 120 runs. Baseline ~$0.50–2/run, atlas ~$5–50/repo, with-docwiki runs ~$1–5/run. Total estimate: $200–700.

## Run environment

Local on the author's machine. Per-repo deps installed in temp clones (no Docker for V1). Prerequisites in `benchmark/README.md`.

## Open questions for the author

1. **Confirm repo picks** (Django / Cal.com / Mastodon vs alternates above).
2. **Cost ceiling:** comfortable at $1000 hard cap? Want lower / higher?
3. **Model:** Sonnet-4-6 only, or also run Opus-4-7?
4. **Hand-curate or auto-fetch the 20 issues?** Hand-curated is more defensible (each issue is vetted); auto-fetched is faster.
5. **Personal-project anecdote.** The `~10% → ~80%` claim originated in your own codebase. Are we including that as a separate "personal-codebase" data point alongside the 3 OSS repos? If yes, what's its sharing surface (sanitized transcripts? aggregate-only?).

Answer these and the harness is ready to scale from skeleton to real runs.
