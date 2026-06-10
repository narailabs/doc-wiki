# Session-agent dispatch harness

> **Superseded (2026-06-10).** The V1 harness and its published runs were withdrawn: sessions ran with unrestricted network access, several curated ticket bodies contained root-cause analysis, and there were no training-data contamination controls. The V2 harness (container isolation, Anthropic-only egress firewall, sanitized tickets, pre-registered calibration) replaces it — see [`docs/superpowers/specs/2026-06-10-benchmark-harness-design.md`](../docs/superpowers/specs/2026-06-10-benchmark-harness-design.md). The curated 25-issue manifest in [`repos.yaml`](repos.yaml) remains valid input and will be re-used (re-sanitized + calibrated) for the V2 django/cal.com/mastodon phase.

The benchmark runs **inside a Claude Code session** using the user's subscription. Each `(repo, issue, condition)` tuple becomes a single isolated subagent dispatched via Claude Code's Agent tool. The subagent IS the "Claude" being measured: it clones the repo, installs deps, optionally runs `/doc-wiki:atlas`, attempts the fix, runs the test, and writes a result JSON.

The original `harness/run.ts` script — which shelled out to `claude -p` as a subprocess — was removed with the V1 withdrawal (see banner).

## Why session-agent over `claude -p`

| `claude -p` (run.ts) | Session-agent (this doc) |
|---|---|
| Spawns a separate Claude Code instance via CLI | Spawns a subagent in the current session |
| Uses whatever auth the CLI has | Uses the host session's auth |
| Each run is fresh — no parent-context leakage | Each subagent is isolated — same guarantee |
| Token accounting in `claude -p`'s JSON output | Token accounting via the parent session's usage |
| Works from a script (TypeScript) | Driven by the Claude Code agent reading this doc |

## How a run happens

1. The orchestrating session (Claude Code) reads `repos.yaml`.
2. For each `(repo, issue, condition)`:
   - Substitute the issue's fields into one of the prompt templates below.
   - Dispatch via `Agent(subagent_type="general-purpose", run_in_background=true)`.
   - The subagent works in `/tmp/bench/<repo>-<issue>-<condition>/`.
3. Each subagent writes its result JSON to `benchmark/runs/<repo>/<issue>/<condition>.json` — the same path `score.ts` reads.
4. After all subagents return, the orchestrator runs `npx tsx benchmark/harness/score.ts` to aggregate.

## Methodology: SWE-bench-style test patch

**Critical.** The test that scores the run was added or modified by the fix PR. If we simply check out the parent commit, the test may not exist (the fix added it) or may be the pre-fix version (the fix updated it). Either case biases the experiment: a model can either fail outright (no test to run) or learn that the test lives in the fix commit (peeking at the answer's location).

SWE-bench resolves this by **pre-applying the test patch** before handing the workspace to the model. We do the same:

```sh
git checkout <fix_commit>^1                       # parent state — source still has the bug
git checkout <fix_commit> -- <test_file_path>     # restore fix-commit version of the test file
git reset HEAD <test_file_path>                   # unstage so git diff HEAD shows source-only later
```

For pytest test paths like `tests/queries/test_q.py::QTests::test_connector_validation`, strip the `::Class::method` suffix to get the file path: `tests/queries/test_q.py`. JS/TS and Ruby test paths are already file paths.

The model never modifies the test file — that's the success criterion.

## Prompt — baseline condition

Substitute the bracketed placeholders. The `[$test_invocation]` field varies by ecosystem: pytest uses `tests/runtests.py path.dot.notation`, vitest uses `yarn test packages/.../foo.test.ts`, rspec uses `bundle exec rspec spec/.../foo_spec.rb`. The setup commands come from the repo's block in `repos.yaml` (`setup:` array).

```
You are benchmarking Claude Code on a real GitHub issue, BASELINE condition (no doc-wiki).

## Workspace

Use /tmp/bench/[$repo_id]-[$issue_id]-baseline. rm -rf then mkdir -p.

## Setup

```sh
cd /tmp/bench/[$repo_id]-[$issue_id]-baseline
git clone --depth 100 [$repo_url] .
git fetch --depth 200 origin || true

# SWE-bench test-patch application:
git checkout [$fix_commit]^1
TEST_FILE="$(echo '[$test_path]' | cut -d':' -f1)"
git checkout [$fix_commit] -- "$TEST_FILE"
git reset HEAD "$TEST_FILE" 2>/dev/null || true

# Install deps
[$setup_commands_from_repos_yaml]
```

If setup fails after 30 minutes, bail with setup_ok=false and a clear error.

## Issue to fix

**Title:** [$issue_title]

**Body:**
> [$issue_body]

## Task

1. Investigate. Find the bug.
2. Fix it. DO NOT modify [$test_path] — that's the success criterion file.
3. Run the test:
   ```sh
   cd /tmp/bench/[$repo_id]-[$issue_id]-baseline
   [$test_invocation]
   ```
4. Success = the test exits 0.

## Limits

- 45 minutes wall-time.
- Smallest fix that makes the test pass wins. Don't over-engineer.

## Output

Write to /Users/narayan/src/doc-wiki/benchmark/runs/[$repo_id]/[$issue_id]/baseline.json:

```json
{
  "schema_version": 1,
  "repo": "[$repo_id]",
  "issue": "[$issue_id]",
  "condition": "baseline",
  "model": "claude-sonnet-4-6",
  "started_at": "<ISO>",
  "finished_at": "<ISO>",
  "duration_s": <float>,
  "setup_ok": <bool>,
  "atlas": null,
  "claude": {
    "exit_code": 0, "turns": <int>, "tokens_in": 0, "tokens_out": 0, "cost_usd": 0,
    "raw": {"session_agent": true}
  },
  "test": {"exit_code": <int>, "success": <bool>, "stdout_tail": "<last 2000 chars>"},
  "diff": "<git diff HEAD truncated to 50000 chars>",
  "error": "<optional, only if blocked from running test>"
}
```

Then `jq . <that file>` to validate, then report 5 sentences: setup duration, fix applied, did test pass, wall time, anything weird.
```

## Prompt — with-docwiki condition

Adds an atlas build step before the fix attempt.

```
You are benchmarking Claude Code on a real GitHub issue, WITH-DOC-WIKI condition.

## Workspace

Use /tmp/bench/[$repo_id]-[$issue_id]-with-docwiki. rm -rf then mkdir -p.

## Setup

Same clone + test-patch + checkout + deps as baseline (see baseline template).

## Build the wiki BEFORE attempting the fix

Run /doc-wiki:atlas on the cloned codebase. From the cloned repo's root:

1. Invoke the doc-wiki skill via the Skill tool:
   Skill(skill="doc-wiki", args="init")
   Skill(skill="doc-wiki", args="atlas --max-cost 50 --facets architecture,data-model,api")

2. Wait for atlas to finish. Capture from its output:
   - atlas duration (seconds)
   - atlas cost (USD)
   - number of wiki pages generated under docs/<app>-wiki/wiki/

3. Verify the wiki landed: ls docs/*-wiki/wiki/

## Now attempt the fix

Same as baseline: find the bug, fix it, run the test. The wiki under docs/<app>-wiki/ and the references it inserts into CLAUDE.md are now part of the implicit context.

DO NOT modify [$test_path].

Run the test:
```sh
[$test_invocation]
```

## Output

Write to /Users/narayan/src/doc-wiki/benchmark/runs/[$repo_id]/[$issue_id]/with-docwiki.json:

```json
{
  "schema_version": 1,
  "repo": "[$repo_id]",
  "issue": "[$issue_id]",
  "condition": "with-docwiki",
  "model": "claude-sonnet-4-6",
  "started_at": "<ISO>",
  "finished_at": "<ISO>",
  "duration_s": <float>,
  "setup_ok": <bool>,
  "atlas": {"ran": <bool>, "duration_s": <float>, "cost_usd": <float>},
  "claude": {
    "exit_code": 0, "turns": <int>, "tokens_in": 0, "tokens_out": 0, "cost_usd": 0,
    "raw": {"session_agent": true}
  },
  "test": {"exit_code": <int>, "success": <bool>, "stdout_tail": "<last 2000 chars>"},
  "diff": "<git diff HEAD truncated to 50000 chars>",
  "error": "<optional>"
}
```
```

## Concurrency

3–6 subagents in parallel is comfortable on a 16-core / 32 GB workstation; more contends on `yarn install` / `bundle install` CPU. Run more after the first wave's installs settle (i.e., when their cloned dirs are fully populated and the CPU drops off the install phase).

## Aggregation

After every `(repo, issue, condition)` has a JSON in `runs/`:

```sh
npx tsx benchmark/harness/score.ts
```

emits `benchmark/results/RESULTS.md` (Markdown headline table) and `benchmark/results/raw.csv` (one row per run). Score schema is unchanged from the run.ts design — the session-agent path is a drop-in producer of the same JSON shape.

## Caveats specific to session-agent dispatch

- **No automatic cost accounting.** Per-run `cost_usd` in the JSON is always 0 because session-agent token usage is billed against the parent session. Total cost lives in the parent session's usage report — sum the subagent task notifications for an approximate per-run figure.
- **Skill access required.** The orchestrating session must have the `doc-wiki` skill loaded for the `with-docwiki` condition. Subagents inherit skills from the parent session.
- **Workspace isolation is filesystem-only.** Subagents are isolated in context (separate Claude instances) but share `/tmp` and host network. A subagent running `yarn install` in one tree may compete with another for npm registry bandwidth.
- **`--mock` mode still works** on `harness/run.ts` for pipeline validation without spending money. The session-agent path replaces real runs, not mock runs.
