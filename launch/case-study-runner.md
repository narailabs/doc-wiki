# doc-wiki case-study runner

> Paste-ready Claude Code prompt for measuring doc-wiki's impact on a real codebase and generating the four deliverables you need for adoption + portfolio + viral launch.
>
> **What this produces:** one structured run-output JSON + four ready-to-publish markdown documents (sanitized portfolio piece, public case study, internal adoption pitch, social variants).
>
> **How to use it:** edit the `PARAMETERS` block at the top to point at your codebase, paste the entire file into Claude Code inside that codebase's repo, let it run all 5 phases. ~1–3 hours wall time depending on codebase size.

---

## Run this prompt inside your codebase (begin paste)

```
# doc-wiki case-study run — read this entire file, then execute all 5 phases
# in order. Do NOT skip phases. Write outputs to ./case-study-output/.

## PARAMETERS — fill these in before running

PROJECT_NAME: <a short generic label for the codebase, e.g. "platform-monolith">
PROJECT_DESCRIPTION: <one sentence on what the codebase does, e.g. "a B2B SaaS booking platform serving N customers">
INTERNAL_TOOL_NAME: <the name of the existing internal documentation tool you built, or "none" if not applicable>
INTERNAL_TOOL_LOCATION: <repo path or URL where the existing tool lives, or "none">
EXTERNAL_CONNECTORS_ENABLED: <comma-separated list of {jira, confluence, github, notion, aws, gcp, db} you have configured>
PRIVATE: <true | false — if true, all outputs use placeholder names; if false, real names are kept in the internal adoption pitch only>
TICKET_SAMPLE_SIZE: <how many real internal tickets to run the benchmark on; recommended 5–10>

## PHASE 1 — Codebase inventory (no doc-wiki yet)

Read the codebase top-down. Produce `./case-study-output/01-inventory.json` with:

- repo_size_loc (total lines of source code, exclude tests/vendor/generated)
- repo_age_years (years since first commit, from `git log --reverse | head`)
- service_count (top-level services or apps, if monorepo; else 1)
- language_breakdown (% by LOC)
- frameworks_detected (Django/FastAPI/Spring/Rails/Express/Next/etc.)
- orm_detected (Prisma/SQLAlchemy/Django/JPA/ActiveRecord/etc., with confidence)
- db_detected (Postgres/MySQL/Mongo/etc., with how — env vars, docker-compose, ORM config)
- external_services_observed (any references to AWS/GCP/Jira/Confluence/Slack/etc. found in code or config)
- existing_documentation_observed:
    - readme_lines
    - in_code_comment_density (rough %)
    - markdown_doc_count (count of `.md` files under `docs/` or similar)
    - quality_subjective (1–5 with one-sentence reasoning)
- complexity_signals:
    - circular_dependencies_count (heuristic via grep)
    - god_modules_count (files > 1000 LOC)
    - schema_drift_observed (if you can compare ORM models to DB schema)
- existing_internal_tool_summary (if INTERNAL_TOOL_NAME != "none"):
    - what_it_does (1-3 sentences)
    - coverage_metric (lines documented / total, or pages-vs-files)
    - last_updated (most recent commit to its output dir)
    - gaps_observed (3–5 specific things the existing tool misses)

Time budget: 30–60 minutes. Use Bash + Read for everything; do not invoke doc-wiki yet.

## PHASE 2 — Build the doc-wiki

If doc-wiki is not installed, install it:
    claude plugin install narailabs/doc-wiki

Then run:
    /doc-wiki:init      # init now subsumes the old onboard step (stack/ORM/DB/services detection)
    /doc-wiki:atlas --dry-run

Read the dry-run output. Confirm the topic discovery, facet plan, and cost estimate look reasonable. If cost estimate exceeds $50, narrow the scope with --scope <directory>.

Then commit:
    /doc-wiki:atlas --max-cost 50

After atlas completes, collect into `./case-study-output/02-atlas.json`:

- atlas_run_id (from atlas output)
- atlas_duration_minutes
- atlas_cost_usd (from atlas output's stats)
- pages_generated (total .md files under docs/<app>-wiki/wiki/)
- topics_covered (list of top-level topic dirs)
- facets_per_topic (avg)
- mermaid_diagrams_generated (count)
- references_inserted_in_claudemd (count of new wiki links added to CLAUDE.md)
- orm_entities_mapped (if ORM detected)
- external_service_pages (count of pages under wiki/integrations/ or similar)

For each generated wiki page, also collect:
- path
- title
- type (concept/runbook/decision/reference)
- sources (frontmatter)
- word_count

Save the per-page index to `./case-study-output/02-pages-index.csv`.

Time budget: 1–3 hours for atlas itself depending on codebase size; +30 min for indexing.

## PHASE 3 — Comparison against existing internal tool

Skip this phase if INTERNAL_TOOL_NAME == "none".

Read the existing internal tool's:
- README / docs
- output directory (whatever it produces)
- sample output pages

Compare against the doc-wiki atlas output along these axes. For each axis, give a 1-paragraph judgment + one specific example:

1. **Code coverage** — does the existing tool cover all source files? Does atlas?
2. **Ecosystem coverage** — does the existing tool ingest Jira/Confluence/DB schemas? Does atlas?
3. **ORM/DB linking** — does the existing tool map ORM entities to DB tables? Does atlas?
4. **Progressive disclosure** — does the existing tool surface a summary-first index? Does atlas?
5. **Drift detection** — does the existing tool flag pages whose source code moved? Does atlas?
6. **Cross-link density** — average inline wiki links per page in each tool's output
7. **Cited-synthesis queries** — can the existing tool answer "How does authentication work?" with citations? Can atlas?
8. **Maintenance cost** — manual effort needed to keep each tool's output current

Save to `./case-study-output/03-comparison.json` with one entry per axis.

Then collect 3 specific anecdotes — moments where doc-wiki captured something the existing tool missed (or vice versa). Format each as:
- axis (which of the 8 above)
- doc_wiki_artifact_path (the wiki page where it shows up)
- existing_tool_artifact_path (or "missing" if absent)
- one-paragraph description of why this matters
- impact_estimate (a sentence on what a developer would do differently because of it)

Save anecdotes to `./case-study-output/03-anecdotes.json`.

Time budget: 1–2 hours.

## PHASE 4 — Ticket benchmark

Select TICKET_SAMPLE_SIZE real, closed internal tickets from the last 6 months. Selection criteria:
- the ticket was actually fixed (PR merged)
- the fix touches 1–3 files (~5–200 LOC change)
- there's a regression test added in the fix PR
- ticket is in this codebase, not a downstream service

**Use the two-workspace pattern from benchmark/PLAN.md**, not a single-tree restore. The wiki + CLAUDE.md references from Phase 2 must be absent for the baseline run and present for the with-doc-wiki run — that isolation requires separate clones, not in-place restore. (In-place restore either fails on the uncommitted wiki/CLAUDE.md changes, or `checkout -f` wipes the very wiki context the with-doc-wiki run is supposed to measure.)

For each ticket, do this:

```sh
# 1. baseline workspace — no wiki anywhere
BASE=/tmp/case-study/<ticket_id>-baseline
rm -rf "$BASE" && mkdir -p "$BASE" && cd "$BASE"
git clone --depth 100 <internal-repo-url> .
git checkout <fix_commit>^1
git checkout <fix_commit> -- <test_file_path>          # apply only the test patch
git reset HEAD <test_file_path> 2>/dev/null || true
# install deps, then:
claude -p "Fix this ticket: <title>\n<body>"
# run the regression test the fix PR added; record pass/fail + duration + tokens + cost

# 2. with-doc-wiki workspace — wiki built from scratch
WDW=/tmp/case-study/<ticket_id>-with-docwiki
rm -rf "$WDW" && mkdir -p "$WDW" && cd "$WDW"
git clone --depth 100 <internal-repo-url> .
git checkout <fix_commit>^1
git checkout <fix_commit> -- <test_file_path>
git reset HEAD <test_file_path> 2>/dev/null || true
/doc-wiki:init
/doc-wiki:atlas --max-cost 30 --scope <directory-containing-the-bug>
# install deps, then:
claude -p "Fix this ticket: <title>\n<body>"
# run the same test; record same fields
```

Atlas runs per (ticket, with-doc-wiki) workspace — yes, this stacks atlas spend, but matches benchmark/PLAN.md's canonical methodology (each condition is a fresh clone; the with-doc-wiki branch builds the wiki from scratch). If you want to amortize, you can build atlas once on a shared workspace and `cp -r` the `docs/*-wiki/` dir + CLAUDE.md references into each with-doc-wiki clone — but document it as a methodology deviation.

Save results to `./case-study-output/04-ticket-bench.csv` with columns:
ticket_id, condition (baseline|with-docwiki), success (bool), duration_s, tokens_in, tokens_out, cost_usd, fix_path, test_path, notes

Compute the headline numbers and save to `./case-study-output/04-summary.json`:
- baseline_pass_rate (% of tickets passing in baseline)
- with_docwiki_pass_rate
- delta_pp (percentage points)
- baseline_median_duration_s
- with_docwiki_median_duration_s
- baseline_total_cost_usd
- with_docwiki_total_cost_usd

Time budget: ~1 hour per ticket if Claude is fast; allow 5–15 hours for a 5–10 ticket sample.

## PHASE 5 — Generate deliverables

From the 4 phases above, produce four documents.

### 5.1 — Sanitized portfolio piece — `./case-study-output/portfolio.md` (~600 words)

Use generic placeholders throughout (PRIVATE=true always):
- Replace company name with `<COMPANY_TYPE>` where COMPANY_TYPE is one of: "a B2B SaaS", "a fintech", "a healthcare platform", "an e-commerce platform", "an enterprise software vendor"
- Replace project name with PROJECT_NAME from parameters
- Use codebase-shape language only: "a ~X00k LOC monolith", "an N-year-old codebase", "Y services in the ecosystem"
- Lead with the benchmark headline (the delta + the methodology + the OSS verification pointer)
- Include one anonymized anecdote from Phase 3
- Close with a link to the OSS doc-wiki repo + the public benchmark

This is the file you can publish on your personal website, dev.to, or LinkedIn without legal risk.

### 5.2 — Public case study — `./case-study-output/case-study-public.md` (~1500 words)

Same as portfolio but longer and more methodology-heavy:
- The codebase shape (no names, just numbers and shape)
- The internal documentation problem (abstract description)
- The doc-wiki rollout approach (the steps you actually took)
- The benchmark methodology (what you measured, how)
- The numbers (Phase 4 results)
- 2 anonymized anecdotes (Phase 3)
- Architecture diagram from doc-wiki atlas, with all names replaced by placeholders (use Mermaid)
- Reproducibility note: "The methodology is reproducible — re-run the same harness against any OSS repo. See [doc-wiki/benchmark/PUBLISH.md](https://github.com/narailabs/doc-wiki/blob/main/benchmark/PUBLISH.md)."

This is what you'd send to a conference CFP or a deep-dive blog.

### 5.3 — Internal adoption pitch — `./case-study-output/internal-pitch.md` (~800 words, NOT for external sharing)

Full detail with real names:
- Lead with: "I built a tool. It already works. Here's the proposal to roll it out across the org."
- Real service names, real ticket IDs, real numbers, real screenshots
- Direct comparison table: existing tool vs doc-wiki across the 8 axes from Phase 3
- The 3 specific anecdotes from Phase 3, with names
- Migration plan: which services first, what success looks like, what happens to the existing tool
- Cost: atlas spend at scale, ongoing maintenance, headcount
- Ask: 4-week pilot on [specific area], with a decision gate at the end

This document NEVER leaves your work account. Keep it on the internal wiki / Notion / etc.

### 5.4 — Social variants — `./case-study-output/social/`

Produce four ready-to-post files, all sanitized:
- `linkedin.md` — ~300 words, professional tone, "I built X, here's what we learned"
- `x-thread.md` — 5–7 tweets, technical, leads with the metric
- `reddit-experienced-devs.md` — long-form (~800 words), candid, no marketing voice, leads with the problem
- `devto-deepdive.md` — ~2000 words, technical methodology piece, embeds the architecture diagram

Each one cites the OSS doc-wiki repo + the public benchmark for verifiability. None mention the company name.

## Sanitization rules (apply to 5.1, 5.2, 5.4)

- No company name
- No team names
- No employee names other than yours
- No specific customer names
- No specific ticket IDs from internal trackers (paraphrase the bug into a general pattern)
- No specific service names — use SERVICE_A, SERVICE_B, etc.
- No screenshots of internal tools, internal Jira, internal Confluence
- Architecture diagrams: replace service/db names with placeholders
- Numbers are kept (LOC, ages, percentages) — these don't identify the company
- Tech stack is kept (Django, Postgres, etc.) — these are too common to identify

When in doubt, replace. The internal pitch (5.3) gets the full detail; the public ones get patterns.

## Output checklist

After all 5 phases complete, verify:
- [ ] `./case-study-output/01-inventory.json` exists
- [ ] `./case-study-output/02-atlas.json` exists
- [ ] `./case-study-output/02-pages-index.csv` exists
- [ ] `./case-study-output/03-comparison.json` exists (if INTERNAL_TOOL_NAME != "none")
- [ ] `./case-study-output/03-anecdotes.json` exists
- [ ] `./case-study-output/04-ticket-bench.csv` exists
- [ ] `./case-study-output/04-summary.json` exists
- [ ] `./case-study-output/portfolio.md` exists
- [ ] `./case-study-output/case-study-public.md` exists
- [ ] `./case-study-output/internal-pitch.md` exists
- [ ] `./case-study-output/social/{linkedin,x-thread,reddit-experienced-devs,devto-deepdive}.md` exist
- [ ] grep through all public outputs for company name, team names, customer names — none should appear

Add `./case-study-output/` to the codebase's `.gitignore` so the artifacts don't accidentally land in a commit to the work repo.

## Summary report

After all 5 phases + the checklist, write a final summary to stdout:
- Total wall time
- Total atlas + Claude spend across all phases
- Headline numbers (baseline pass rate, with-doc-wiki pass rate, delta)
- The 3 anecdotes (one-line each)
- Where each deliverable is located
- One sentence on what surprised you the most while running this
```

## End of paste

---

## How to use the four deliverables

| File | Audience | When to publish |
|---|---|---|
| `portfolio.md` | You (LinkedIn, personal site, cover letter) | After OSS doc-wiki launch lands; doesn't require permission from current employer |
| `case-study-public.md` | Conference CFPs (AI Engineer Summit, QCon), deep-dive blog | After 4-week internal pilot is documented |
| `internal-pitch.md` | Your current employer's engineering leadership | **Before** you start interviewing externally |
| `social/*.md` | LinkedIn, X, Reddit, dev.to | T+1 to T+30 of doc-wiki public launch |

## A recommended sequence

1. **Run the prompt on the simpler project first** — gets you a feel for it, less risk if a phase fails.
2. **Use the internal pitch (5.3) to get sanctioned internal adoption.** Run a 4-week pilot. Document the actual numbers your team observes — this is your "I shipped impact" evidence for the next job.
3. **After 4 weeks**, re-run the prompt to get fresh numbers. Update the public deliverables with the longer-baseline data.
4. **Then publish the social variants** as part of the doc-wiki OSS launch wave. Lead with the OSS benchmark; reference your internal pilot as "case study — Fortune 500 SaaS, see [link to case-study-public.md]".
5. **Reserve the named version (5.3) for interviews.** "I rolled this out at $current_employer, here's what we measured — happy to walk through details under NDA."

## What this prompt does NOT do

It doesn't make your current employer sanction the rollout. That's a separate conversation you have with your manager *before* running the pilot. The internal pitch (5.3) is the doc you bring to that conversation; the prompt produces a draft, you edit it for tone.

It also doesn't replace the OSS launch. The OSS launch is what gives you a public artifact people can verify. The case study is what gives that public artifact credibility on enterprise codebases. Both are needed.
