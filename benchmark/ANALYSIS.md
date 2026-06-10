# Benchmark analysis — what we actually measured

> **Superseded (2026-06-10).** The V1 harness and its published runs were withdrawn: sessions ran with unrestricted network access, several curated ticket bodies contained root-cause analysis, and there were no training-data contamination controls. The V2 harness (container isolation, Anthropic-only egress firewall, sanitized tickets, pre-registered calibration) replaces it — see [`docs/superpowers/specs/2026-06-10-benchmark-harness-design.md`](../docs/superpowers/specs/2026-06-10-benchmark-harness-design.md). The curated 25-issue manifest in [`repos.yaml`](repos.yaml) remains valid input and will be re-used (re-sanitized + calibrated) for the V2 django/cal.com/mastodon phase.

> Honest reading of the 14-run benchmark (7 real OSS issues × 2 conditions). Run via session-agent dispatch on 2026-06-03 against `claude-sonnet-4-6`. Methodology: SWE-bench-style test patch applied at parent commit; subagent edits source only.

## V1 headline — withdrawn, see banner (113 runs, 25 issues, N=1–3)

| | Baseline | With doc-wiki | Δ |
|---|---|---|---|
| **Pass rate** | 50/53 (94.3%) | 57/57 (100%) | **+5.7 pp** |
| **Cells with positive delta** | n/a | 3 of 18 (+33 pp each) | — |
| **Median wall time** | broad: 100s–3100s | broad: 200s–5100s | wider on wdw due to atlas + parallel-load congestion |
| **Atlas spend** | n/a | $2.65 reported / many builds | session-agent under-reports |

When the run set scales beyond 32 runs to a heterogeneous 113, **the delta becomes non-zero**: doc-wiki shows a measurable +5.7 pp advantage. Drivers:

- `cal-com/19163`: baseline 2/3 — r1 hit ENOSPC during yarn install (host disk filled to 100% under parallel load); wdw 2/2 ✓.
- `django/37036`: baseline 2/3 — r1's agent stalled at 110s with only 22 tool uses and "ran the test without any source fix"; wdw 3/3 ✓.
- `mastodon/19985`: baseline 2/3 — r1's spec failed at file level due to Vite manifest infra not loading (10 unrelated tests broke), even though the issue-specific tests passed; wdw 2/2 ✓.

The doc-wiki advantage at this scale isn't "Claude finds bugs the baseline can't find." It's **operational resilience**: when an agent hits an environmental constraint (disk, race, install corruption) or gives up prematurely, the wiki page atlas authored beforehand still encodes the invariant, so the next replicate (or a retry under different load) tends to converge cleanly.

## Multi-run variance (3 hard cells at N=3)

| Cell | Pass | Durations (s) | Range / median spread |
|---|---|---|---|
| cal-com/22319 baseline | 3/3 | 162, 240, 305 | 143s spread |
| cal-com/22319 with-docwiki | 3/3 | 189, 210, 295 | 106s spread |
| django/37057 baseline | 3/3 | 102, 108, 486 | 384s spread (2 fast + 1 slow outlier) |
| django/37057 with-docwiki | 3/3 | 160, 720, 870 | 710s spread |
| mastodon/38376 baseline | 3/3 | 30, 934, 960 | 30s is likely an agent self-reporting bug; setup-time variance otherwise tight |
| mastodon/38376 with-docwiki | 3/3 | 234, 374, 1500 | 1266s spread |

Headline takeaway from the variance: **pass rate is invariant; wall time isn't.** The variability is dominated by setup — clone speed, dep-install caches, registry rate-limits, atlas page-count decisions — not by the LLM-fix portion itself. When the fix portion gets isolated (durations after `yarn install` finishes), variance shrinks dramatically. The literature warns about 60% → 25% degradation across reruns for production agent tasks; we don't see it here, possibly because the test patch + focused issue prompts give Claude an unambiguous goal that defangs the variance problem.

## What this proves

- The session-agent harness works end-to-end (clone → install → optional atlas → fix → test → JSON).
- Claude Sonnet 4.6 reliably reproduces upstream fixes for tractable, well-scoped OSS bugs given (a) the issue description, (b) the upstream-authored test, and (c) the parent-commit source tree.
- doc-wiki's atlas step doesn't degrade the baseline. Both conditions succeed; neither breaks anything.
- Atlas frequently generates architecturally-correct pages that capture the invariant relevant to the fix. Three notable cases:
  - **cal-com/27963:** atlas page `duration-types/architecture.md` contained "hours → days divides by HOURS_IN_DAY (24), not multiplying" — literally the fix.
  - **django/37047:** atlas page included a "Cross-Reference: Helpers That Already Do This Right" table pointing at `get_order_dir` — pushed Claude toward the canonical helper instead of a naive `lstrip("-")`.
  - **mastodon/37652:** atlas page captured the HASHTAG_RE invariant ("any adjacency that isn't a clean word boundary should not count") and the positive-lookbehind technique.

## What this does NOT prove

The "~10% → ~80% accuracy lift" claim from the project's README hero is an **anecdotal observation on the author's private enterprise codebase**, not a number this OSS benchmark produces. The OSS benchmark's 100% / 100% / 0pp result is not evidence for the 10→80 claim. The README needs to be reworded to separate the two.

## Why baseline already hits 100% (selection bias)

The 25 curated issues were chosen for tractability:
- 6–195 LOC per fix (mean ~50)
- Each PR adds or modifies a focused, named test
- Linked to a clean issue ID with a meaningful body
- From repos with strong test infrastructure (Django, Cal.com, Mastodon)

That's almost the perfect-case shape for Claude Code: small surface, sharp success criterion, clean codebase. Baseline rarely fails here. So measuring "doc-wiki vs baseline" on these issues measures **whether atlas hurts**, not whether atlas helps.

The doc-wiki value proposition — context engineering for messy enterprise codebases — is structurally invisible at this scale of difficulty. To see a real delta you'd need:

1. **Cross-file bugs** where the fix requires understanding a contract that spans modules.
2. **Tribal-knowledge bugs** where the right fix depends on past decisions documented in Jira/Confluence, not the source.
3. **Schema-drift bugs** where the ORM models disagree with the live DB.
4. **Ambiguous bugs** without a single failing test that pinpoints the location.
5. **Larger codebases** where baseline's exploration cost grows non-linearly.

None of those are in the current 25-issue manifest. They're harder to curate (require deep codebase knowledge to pick), harder to reproduce (often involve services / DBs / external state), and harder to score (no single failing test).

## What atlas actually delivers when both conditions succeed

When success rates are tied, the relevant question is **fix quality**. Two patterns emerged:

1. **Architectural alignment.** With-doc-wiki agents tend to use canonical helpers / pre-existing patterns. Baseline sometimes invents an inline solution that passes the test but doesn't match the codebase's conventions. Example: django/37047 — baseline did a working fix, with-doc-wiki used `get_order_dir` (the helper already in `query.py:2788`).
2. **Broader fix scope.** With-doc-wiki sometimes produces more sweeping fixes that address the root cause across multiple files. Example: django/36966 — baseline added `query_params = None` to one branch, with-doc-wiki dropped `query_params` entirely from `_follow_redirect`/`_handle_redirects`/`_ahandle_redirects` and all 8 call sites.

Neither of these shows up in a binary pass/fail score. Capturing them would require a code-review-style rubric on the diffs — beyond the SWE-bench-style binary methodology.

## Atlas overhead

| Repo | Atlas duration | Atlas $ | Pages |
|---|---|---|---|
| cal-com (27963) | 156s | $0.65 | 3 |
| django (36966) | 169s | — (session-agent reported $0) | 5 |
| mastodon (37652) | 344s | $0.45 | 3 |
| django (37047) | 132s | — | 2 |
| cal-com (28764) | new build per issue | new cost | 2 |

Atlas scope was narrowed in every case (`--scope packages/lib`, `--scope django/db/models/sql`, `--scope app/models`, etc.) — full-repo atlas would cost more. The `$0` rows are session-agent runs where the subagent had no way to read its own Anthropic billing; total spend lives in the parent session's usage report.

## Methodological note: scope-of-fix vs. scope-of-test

When the test patch is narrower than the full upstream PR (which is common — tests often validate a single hook or function while the PR also wires it into the surrounding code), an agent can pass the test by implementing only the hook surface. Example from cal-com/22319 r1: the agent implemented a 41-LOC `useStableTimezone` hook that satisfies the 8-test spec, but the upstream PR also wired the hook into `Booker.tsx` and added `needSlotsRefresh` plumbing. Both diffs "pass the benchmark." The agent's diff is narrower. SWE-bench's binary success metric doesn't distinguish them.

Two ways to handle this in v2:
1. **Expand the test patch** to include integration tests that catch the missing wiring. Some PRs already do this; ours don't always.
2. **Add a diff-similarity metric** (Jaccard or LLM-judge) against the upstream PR diff. Reports "passed test, X% of upstream PR scope" — a more informative number than pass/fail alone.

## Methodological notes (worth fixing for v2 of this benchmark)

1. **`repos.yaml` SHA validation is shallow.** The original curation agent only checked SHAs exist; one (django/36966) belonged to a different ticket. Future curation should also verify the commit message / PR body references the named issue ID.
2. **Test-patch application must be orchestrator-side.** The first cal-com baseline attempted the work and discovered it had to reconstruct the test from the fix commit — biased toward success because the agent learned where the answer lives. The corrected pattern (applied to runs 4+) is: orchestrator pre-applies the test patch via `git checkout <fix> -- <test_path>`; subagent only edits source.
3. **Session-agent cost tracking is absent.** Per-run cost in the JSON is 0 because the subagent has no token-accounting hook. Total cost lives in the parent Claude Code session's usage stats — sum the agent task notifications manually for an approximation.
4. **Selection bias dominates.** Section above. To make this benchmark *interesting* for doc-wiki, the issue set has to include hard, ambiguous, multi-file bugs in larger codebases.

## Recommendations for the launch

1. **Don't lead with the 10→80 OSS-benchmark framing.** It doesn't match what the benchmark says.
2. **Lead with the anecdotal personal-codebase claim, clearly labeled.** "On the author's 500k-LOC enterprise codebase, autonomous ticket-fix accuracy went from ~10% to ~80%. The OSS benchmark in `benchmark/` shows both conditions ace tractable issues (7/7 each) — the OSS delta is structurally smaller because OSS codebases are already cleaner than the median enterprise mess."
3. **Surface the atlas value qualitatively.** "Even when both conditions succeed, the wiki page atlas writes often encodes the exact invariant driving the fix. Three concrete examples in `ANALYSIS.md`." Pair with screenshots of those wiki pages.
4. **Invite hostile reproduction.** "Re-run the harness on a codebase of your choice. Swap `repos.yaml`. If the OSS delta stays at 0pp on your harder issues, tell me — that's a real product signal."
5. **Position the benchmark as a `does this work` check, not a `does this win` argument.** That framing matches what was actually measured.
