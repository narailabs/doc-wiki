# How to publish this benchmark (and have it land)

> Companion to [`ANALYSIS.md`](ANALYSIS.md). Strategy doc for taking the benchmark public — how to position it, where to publish, which voices to reach, and what to do next to make it stronger.

## Position truthfully or it backfires

The benchmark says **doc-wiki doesn't move pass rate on tractable OSS issues, but the wiki pages frequently encode the fix invariant and sometimes lead to faster fixes.** That's a real, interesting finding — and it survives reproduction. The temptation will be to lead with the personal 10→80 number because it's more dramatic. Don't.

The reason: every AI-coding launch post-Devin is read by reviewers who instinctively check whether headline numbers are reproducible. If they see "10→80" on the README and then find the OSS benchmark shows 0 pp delta, the gap reads as bait-and-switch. The credibility damage outweighs the dramatic-number lift.

The framing that lands:

1. **Lead** — "On 7 real OSS issues, doc-wiki and baseline Claude Code both pass 100%. Here's why that's still a useful number, and three concrete cases where the wiki page literally encoded the fix invariant."
2. **Then** — "On my private enterprise codebase (different shape, not OSS), I measured ~10% → ~80% autonomous ticket-fix rate. That number is anecdotal; here's the methodology and a reproducible OSS harness so you can argue with it."
3. **Reframe** — "The benchmark proves doc-wiki works without hurting accuracy; the *delta* will be most visible on the messy enterprise codebases doc-wiki is built for, which OSS doesn't model well."

This framing keeps both numbers honest and pre-empts the bait-and-switch read.

## What makes this benchmark interesting on its own

Even before the doc-wiki angle, this is a publishable artifact:

- **SWE-bench-style harness in a Claude Code session.** Reviewers haven't seen subagent-dispatched benchmarks much. The dispatch pattern in [`dispatch.md`](dispatch.md) is a reusable contribution to the agent-benchmark community.
- **Real merged PRs, real test patches, binary scoring.** Methodology survives a hostile review.
- **Variance reporting built in.** Each `(repo, issue, condition)` cell can hold N replicates; the score script computes median and min-max.
- **Transparent caveats.** The README and `ANALYSIS.md` flag selection bias, session-agent cost tracking gaps, and the curation-quality SHA issue we found (django/36966).

That's enough to publish as a methodology contribution, not just a doc-wiki marketing artifact.

## Where to publish (ordered by ROI for a methodology piece)

1. **dev.to or your own blog, long-form.** ~2500 words. Frame as "I built a SWE-bench-style harness inside Claude Code sessions — here's what I learned." Link to the repo. The methodology + the doc-wiki product live side-by-side.
2. **HackerNews — Show HN, second post.** Different from the doc-wiki launch HN post. Title: "Show HN: SWE-bench-style benchmark for AI coding agents that runs inside Claude Code session." Body explains the session-agent dispatch pattern. The doc-wiki tie-in is one paragraph deep in the post.
3. **r/LocalLLaMA and r/ClaudeCode.** Same blog post cross-linked, different framings per sub. LocalLLaMA cares about reproducibility; r/ClaudeCode cares about Claude Code workflow patterns.
4. **The Pragmatic Engineer / Latent Space.** Cold-pitch with the methodology angle, not the doc-wiki product angle. "I built X benchmark, here's the methodology" is more interesting to those audiences than "buy my tool."
5. **arXiv (yes, really).** Even a 4-page methods note on the session-agent dispatch pattern + variance findings is publishable. Cite SWE-bench Verified and OpenAI's Deep Research benchmark variance literature. Crossposts well to Twitter ML circles.

## Voices to reach (warm asks)

These people care about agent benchmark methodology and are reachable cold-but-informed:

- **Paul Gauthier (aider)** — runs his own benchmarks; would respect this methodology. Aider's leaderboards are the closest existing reference.
- **Carlos E. Jimenez (SWE-bench)** — original author. A "we extended SWE-bench-style methodology to in-session dispatch" pitch is the right shape.
- **Anthropic's eval team** (Amanda Askell, others) — they care about reproducibility in agent evals.
- **Simon Willison** — his "vibe engineering" framing of repeatable AI workflows is adjacent to this benchmark.
- **swyx (Latent Space)** — covers AI eng patterns; this is an eng pattern.
- **Gergely Orosz (Pragmatic Engineer)** — covers AI tooling adoption; the "we measured both conditions, here's what we found" angle is exactly the data-driven framing he prefers.

Send the benchmark before the doc-wiki product. The benchmark gives them something concrete to react to that isn't asking for a product endorsement.

## What to lead the post with (the hook)

The strongest hook in the data: the **qualitative-fix-quality observation** on django/37047.

> Both conditions passed the test. But the with-doc-wiki agent's diff used `get_order_dir` (Django's canonical helper for parsing order_by prefix). The baseline agent did a naive `lstrip("-")`. Both work. One matches the codebase's conventions. The wiki page literally contained a "Cross-Reference: Helpers That Already Do This Right" table pointing at the canonical helper.
>
> This is the actual doc-wiki value proposition that the benchmark surfaced: not "did the test pass" but "does the diff look like upstream wrote it." Binary pass/fail underrates this. The right metric is closer to code review.

That paragraph is the launch's emotional core. Lead with it.

## Concrete next steps to make the benchmark stronger before publishing

If you want the published version to land as a methodology contribution (not just an artifact), do these in order:

### Tier 1 — required before publication

- [x] **Spot-check all 25 curated SHAs** for issue-to-commit relevance, not just commit existence. **DONE 2026-06-03 — 25/25 pass.** Verified via `benchmark/harness/verify-curation.ts` which checks commit message, PR title/body, and PR `closingIssuesReferences` (GraphQL) for an issue-ID reference. Report at `benchmark/results/curation-report.md`. The previously-wrong django/36966 entry was already corrected in repos.yaml.
- [ ] **Run each existing easy-issue cell ≥3 times** to put real variance numbers in the table. 7 single-run cells × 2 more replicates each = 14 more runs. Cheap, fast.
- [ ] **Pre-install all 3 toolchains in a setup script** (`benchmark/setup-host.sh`): brew install python@3.12 ruby@3.3 postgresql@16 libidn vips. Document required versions in `benchmark/README.md`.
- [ ] **Fix per-run cost capture.** Session-agent runs report $0 because the subagent has no token-billing read. Either (a) approximate from `total_tokens` × published per-token prices, computed by the orchestrator after each subagent returns, or (b) switch to `claude -p` subprocess mode for the published benchmark since it captures cost in the JSON.

### Tier 2 — strongly recommended

- [ ] **Add 5-8 harder issues to the manifest.** Cross-file fixes, schema-drift bugs, multi-symptom debugging. The current 25 are all SWE-bench-shaped (small, single test, clean codebase). To make the benchmark *interesting* for doc-wiki you need issues where baseline genuinely struggles. Candidates: cal-com/22319, mastodon/38376, mastodon/38203 — already in the manifest, just need harder examples.
- [ ] **Run on a private enterprise repo (sanitized).** A single-repo case study from the author's day job, anonymized, with the same harness. Even a 10-issue private cell would carry more weight than 100 easy OSS issues. The OSS benchmark validates methodology; the private case validates the product.
- [ ] **Add a code-review-quality rubric for the diffs.** When both conditions pass, what's the *quality* delta? Three signals: (a) does the diff use existing helpers / canonical patterns; (b) is the fix scoped tightly or sprawling; (c) does it touch unrelated code. Could be human-rated or LLM-judge'd from the diff text.
- [ ] **Bench across model tiers.** Same harness, same issues, Haiku 4.5 vs Sonnet 4.6 vs Opus 4.7. A model-tier delta table is independently interesting and pulls in readers who don't care about doc-wiki.

### Tier 3 — nice to have

- [ ] **Public dashboard.** Auto-deployed page with per-cell pass rates + diff viewer. Backstage-style cred without the cost.
- [ ] **CI re-run on every PR.** GitHub Actions runs the validate.ts + 1 smoke test per PR. Proves the harness stays maintained.
- [ ] **Cross-tool extension.** Same dispatch pattern but pointed at Cline / OpenCode / Cursor agents. Now the benchmark stops being "doc-wiki for Claude Code" and starts being "agent benchmark for any AI coding tool."

## The Devin-tax to budget for

Anyone publishing AI-agent benchmark numbers in 2026 inherits the Devin-credibility tax. Reviewers will:

1. Try to re-run the harness within 24h of seeing it.
2. Swap in their own issues to see if the methodology generalizes.
3. Look for cherry-picking (why these issues, not others?).
4. Look for self-bias (are the agents tuned for this codebase?).

Pre-empt all four:

1. The `dispatch.md` doc + the SWE-bench test-patch methodology should be the first thing readers see in `benchmark/`.
2. `repos.yaml` is editable; encourage swaps in the publish post explicitly.
3. The honest selection-bias paragraph in `ANALYSIS.md` is your moat against the cherry-picking review.
4. The subagent prompts are all in `dispatch.md`. They're not tuned per codebase. Reviewers can read them.

## Timeline for a real launch (realistic, with hard issues data in hand)

| Week | What |
|---|---|
| 0 | Finish Tier 1 — clean SHAs, multi-run variance, host-setup script, cost capture |
| 1 | Run the harder issues (`Tier 2` first item). Generate the variance + delta tables. |
| 2 | Write the 2500-word blog post leading with the django/37047 qualitative finding. Draft the Show HN, the X thread. |
| 3 | Cold-pitch Simon Willison, Gergely Orosz, swyx with the post link + 60-sec demo of the benchmark running. (No product pitch; just the benchmark.) |
| 4 | Show HN Tuesday morning. Pinned X thread. Discord drops. r/ClaudeCode + r/LocalLLaMA cross-posts with different framings. |
| 5+ | Respond to reproduction attempts publicly. Every "I re-ran on repo X and got Y" is a free credibility lift. |

The benchmark publish is the lead artifact for the doc-wiki launch, not a separate event. It runs about 2 weeks ahead of the main doc-wiki Show HN.

## One sentence to close the launch post with

> *"Apache 2.0 forever. Re-run it on a codebase of your choice. If you get a different number, publish it — that's the contract."*
