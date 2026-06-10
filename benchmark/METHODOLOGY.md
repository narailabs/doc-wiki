# Methodology

**Claim under test:** a doc-wiki generated wiki in the repo improves Claude Code's autonomous ticket-fix pass rate on real closed issues.

**Design:** paired two-arm runs per ticket (baseline / wiki) — identical container, model (`claude-sonnet-4-6`, pinned full ID), prompt, and flags; the only delta is the presence of the pre-built wiki + `CLAUDE.md` in the checkout (committed before the session so the agent's diff contains only its own work). Grading: the real fix PR's tests, overlaid onto the agent's diff (SWE-bench style). Pass = all overlaid tests pass; a pass that needed the configured single retry is recorded distinctly (`tests-passed-on-retry`).

**Ticket eligibility:** closed issue with a merged linked fix PR touching both test and non-test source, <400 changed lines, natural-language body ≥200 chars, human author, merged after the repo's `ticket_after` floor. The committed `tickets/<repo>.json` is the exact set, including every exclusion and its reason.

**Contamination controls:**
1. *Fix leak:* the wiki is built at `wiki_commit`, verified (`git merge-base --is-ancestor`) to predate every ticket's base commit.
2. *Issue-body leak:* bodies are sanitized (forward issue/PR references, cross-repo and GH-style references, commit SHAs, "fixed by" lines, github URLs stripped); every redaction is logged in the ticket record alongside the verbatim body for audit.
3. *Online-lookup leak:* agent sessions run behind an egress firewall (IPv4 + IPv6) allowing only Anthropic endpoints; repo installs happen before the firewall comes up.
4. *Training-data leak:* tickets postdate `ticket_after` (set from the pinned model's training cutoff); merge dates are published per ticket.

**Calibration (pre-registered):** before any agent runs, each ticket's fix-PR tests must fail on the clean base commit (overlaid from the fix commit — newly-added regression tests are the canonical shape) and pass on the fix commit, with every test path present at the fix commit. Failures are excluded up front, with reasons logged in the committed ticket file.

**Known caveats:**
- Single run per (ticket, arm): no variance estimate per ticket; treat per-repo aggregates, not per-ticket outcomes, as the signal.
- OSS repos ≠ enterprise codebases. The author's enterprise-codebase experience (the README hero number) is an anecdote, not this benchmark's claim; the benchmark's claim is whatever RESULTS.md says.
- Ticket discovery uses GitHub's `closingIssuesReferences` (keyword-linked issues only) — PRs that reference an issue solely in free-text prose are not mined, so the candidate pool understates true fix volume. Selection bias is toward well-linked, process-followed fixes.
- Rebase-merged PRs can make `base_commit` (merge-commit parent) partially contain the fix; the calibration gate excludes them. `merge_parents` on each ticket record flags true merge commits (=2); rebase merges have a single parent and are detectable only via calibration.
- `--max-turns` (default 80) and container timeout (default 1800s): final pilot values recorded here when calibration completes.

**Reproduction:** see [README.md](README.md). Total cost and wall-clock for the published runs: recorded in RESULTS.md when the pilot completes.
