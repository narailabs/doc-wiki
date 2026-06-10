# Benchmark Harness — Design

> Status: approved design, pre-implementation. Date: 2026-06-10.
> Launch-plan context: this is **Anchor 1** of the launch campaign — the reproducible benchmark that gates publishing the "~10% → ~80% ticket-fix accuracy" claim.

## Goal

Measure Claude Code's autonomous ticket-fix pass rate on real closed issues from recognizable OSS repos, **baseline vs with a doc-wiki wiki present** — 3 repos × ~20 tickets × 2 arms — and publish a harness that a skeptical third party can clone and re-run with their own Claude subscription.

Deliverables: a `benchmark/` directory (harness + per-repo configs + mined ticket lists), `RESULTS.md` (the numbers), `METHODOLOGY.md` (selection criteria, controls, caveats, reproduction steps), and published per-run transcripts.

## Decisions log

| Decision | Choice | Why |
|---|---|---|
| Runner | Headless Claude Code (`claude -p`) on the author's Max subscription | doc-wiki runs inside Claude Code; the benchmark must measure the real product surface. No direct API usage. |
| Grading | The real fix's tests (SWE-bench style) | Objective and reproducible. LLM-judge and manual grading rejected as attackable/self-graded. |
| Isolation | Docker container per run, `--dangerously-skip-permissions` inside | Unattended runs execute agent-written code; containers make that safe and the methodology reproducible. |
| Model | Pinned `claude-sonnet-4-6` (full ID, not the `sonnet` alias) | Alias drift would break comparability; Sonnet gives rate-limit headroom for ~120+ runs. |
| Orchestration | Deterministic TypeScript harness (Approach A) | The only LLM in the loop is the session under test. A Claude-orchestrated benchmark would conflate instrument and subject. |
| Pilot | 1 repo × ~20 tickets end-to-end before scaling to 3 | Prove the methodology cheaply first. Pilot repo selection in progress (candidate-screening research running; design is repo-parameterized). |

## Verified platform facts (with doc sources)

These were verified against current Claude Code documentation on 2026-06-10:

- `claude -p "<prompt>"` print mode loads plugins/skills by default and can invoke plugin slash commands (e.g. `/doc-wiki:atlas --cross-service --yes`) as the prompt. — code.claude.com/docs/en/headless.md
- `claude setup-token` mints a 1-year OAuth token drawing on the user's subscription quota, consumed via the `CLAUDE_CODE_OAUTH_TOKEN` env var — works on a Linux container. Inference-scoped. Note: `--bare` mode does **not** read this var, so the harness avoids `--bare` and achieves clean-room isolation via `CLAUDE_CONFIG_DIR` instead. — code.claude.com/docs/en/authentication.md
- `--model claude-sonnet-4-6` works in `-p` mode with subscription auth. — code.claude.com/docs/en/model-config.md
- `--output-format json` emits `result`, `session_id`, and `total_cost_usd`; full transcripts persist under the config dir's `sessions/`. — code.claude.com/docs/en/headless.md
- Runaway guards: `--max-turns <N>`; `--dangerously-skip-permissions` works in `-p` mode. — code.claude.com/docs/en/cli-reference.md
- Clean-room: fresh `CLAUDE_CONFIG_DIR` (container HOME) avoids global settings/plugins/MCP contamination; `--plugin-dir` can load a single plugin when needed (only the atlas build needs doc-wiki). — code.claude.com/docs/en/headless.md
- No official Docker base image; install pinned `@anthropic-ai/claude-code@<version>` via npm on `node:20`, set `DISABLE_AUTOUPDATER=1`. — code.claude.com/docs/en/devcontainer.md
- Rate-limit hit mid-run surfaces a `You've hit your … limit · resets …` message (exit code undocumented); the harness detects the message pattern. — code.claude.com/docs/en/errors.md

## Architecture

```
benchmark/
├── harness/
│   ├── mine_tickets.ts     # GitHub API → tickets/<repo>.json
│   ├── build_wiki.ts       # one-time /doc-wiki:atlas run per repo (in container)
│   ├── run_ticket.ts       # one (ticket × arm) Claude Code session in Docker
│   ├── grade.ts            # overlay real fix's tests, run them, pass/fail
│   ├── report.ts           # aggregate checkpoints → RESULTS.md
│   └── docker/             # Dockerfile + entrypoint.sh
├── repos/<repo>.yaml       # per-repo config (see schema below)
├── tickets/<repo>.json     # mined eligible tickets (committed)
├── runs/                   # per-run raw outputs: diff, transcript, grade.json (gitignored; published as a release artifact)
├── RESULTS.md
└── METHODOLOGY.md
```

TypeScript, Node 20, Vitest — same conventions as the rest of the repo (`npm run build` emits sibling `.js`; both committed). Entry point: `npm run benchmark -- <mine|build-wiki|run|grade|report> --repo <id> [--arm baseline|wiki] [--batch N] [--ticket <issue#>]`.

### Per-repo config (`repos/<repo>.yaml`)

```yaml
id: flask
github: pallets/flask
clone_url: https://github.com/pallets/flask.git
language: python
install: ["pip install -e .[dev]"]          # run inside container at build/run time
test_command: "python -m pytest {test_files} -x -q"
test_patterns: ["tests/**", "**/test_*.py", "**/*_test.py"]  # what counts as a test file — REQUIRED, per repo
wiki_commit: <sha>                           # pinned commit the wiki was built at (see selection rule below)
toolchain: ["python:3.12"]                   # extra container layers
services: []                                 # e.g. postgres — empty preferred
```

`test_patterns` is the single definition of "test file" for that repo, used identically by mining (criterion 1) and grading (overlay step) — there is no global heuristic. `wiki_commit` selection rule: **the parent of the oldest eligible ticket's `base_commit`** (or the latest release tag preceding it, if one exists within 30 days). Mining hard-fails any ticket whose `base_commit` is not strictly newer than `wiki_commit`.

### Ticket record (`tickets/<repo>.json` entries)

The file carries a top-level `schema_version: 1` so future field additions are explicit. Entries:

```json
{
  "issue": 5301, "issue_url": "…", "title": "…", "body": "…", "body_sanitized": "…",
  "fix_pr": 5310, "fix_pr_url": "…",
  "base_commit": "<fix PR parent sha>",
  "fix_commit": "<fix PR merge sha>",
  "test_files": ["tests/test_x.py"],
  "src_files": ["src/x.py"],
  "changed_lines": 87,
  "calibration": { "tests_fail_on_base": true, "tests_pass_on_fix": true }
}
```

## Ticket mining (`mine_tickets.ts`)

Eligible ticket = closed issue where the merged linked fix PR:

1. touched **both** test files and non-test source files,
2. changed **< 400 lines** total (no giant refactors),
3. is linked from an issue with a real natural-language body (length threshold; not a bare title),
4. was not authored by a bot,
5. has `base_commit` **newer than `wiki_commit`** (see contamination control).

Mining walks closed issues/merged PRs via the GitHub API (authenticated `gh`), resumable across API rate limits. Output is committed so the exact ticket set is part of the public methodology.

## Contamination control

**The wiki is built once per repo at a pinned commit (`wiki_commit`) strictly older than every ticket's `base_commit`.** The wiki therefore cannot encode knowledge of any fix being tested. The staleness this introduces biases *against* doc-wiki — the conservative, defensible direction.

Two further leak vectors are closed explicitly:

- **Issue-body leak:** issue bodies sometimes name the fix ("fixed in #5310") or link commits. Mining stores both `body` (verbatim, for auditability) and `body_sanitized` — the body with PR/issue cross-references numbered ≥ the issue itself, commit SHAs, and "fixed by/in" phrases stripped, each replacement logged. Sessions receive `body_sanitized`.
- **Online-lookup leak:** the agent session could otherwise `gh`/`curl` the real fix PR. During the agent session the container's egress is firewalled to an allowlist of Anthropic API endpoints only (the approach used by Anthropic's reference devcontainer); repo `install` runs *before* the session with normal egress. The firewall is part of the published image, so reproducers inherit it.

Both arms run **byte-identical session configs**; the only delta is whether the generated `docs/<name>-wiki/` (plus its `CLAUDE.md` pointer) is present in the checkout:

- Fresh `CLAUDE_CONFIG_DIR` per run (container-local) — no global settings, plugins, or MCP servers leak in. The doc-wiki *plugin* is not loaded in ticket sessions; only the atlas build session loads it via `--plugin-dir`.
- Same prompt template for both arms: issue title + body verbatim, followed by a fixed instruction: *"Investigate and fix this issue in this repository. Run the relevant tests to check your fix."* No mention of the wiki in either arm — the wiki arm must discover it the way a real agent would (via `CLAUDE.md`).
- Same flags: `--model claude-sonnet-4-6 --output-format json --dangerously-skip-permissions --max-turns <N>`.

## Run protocol (`run_ticket.ts`)

1. Container starts from a cached bare-clone volume; checks out `base_commit` into a fresh workdir; runs repo `install`.
2. Wiki arm only: overlay the pre-built wiki directory + `CLAUDE.md`.
3. Invoke `claude -p` with the templated prompt and pinned flags; `CLAUDE_CODE_OAUTH_TOKEN` passed as a `docker run` env var (never baked into the image, never committed, never logged).
4. Capture the agent's work as `git add -A && git diff --cached --binary` (catches new/deleted/binary files, not just edits), the JSON result envelope (`total_cost_usd`, `session_id`, duration), and the raw session transcript copied out to `runs/<repo>/<issue>/<arm>/transcript.jsonl` alongside `diff.patch` and `result.json`.
5. Hard caps: container wall-clock timeout (default 30 min) and `--max-turns`.

Both arms of a ticket run back-to-back (paired), minimizing time-of-day and model-version drift between arms.

### Checkpointing & rate limits

A checkpoint JSON tracks every (repo, ticket, arm) through `pending → running → passed | failed | error | rate-limited`. Atomic writes, same pattern as `skills/doc-wiki/scripts/checkpoint.ts`. Transition rules:

- `passed`/`failed` are terminal (agent-attributable outcomes are never silently re-run).
- `error` and `rate-limited` revert to `pending` on resume.
- A `running` entry found at startup (prior crash) reverts to `pending`.
- Resume completes **partial pairs first** — if a ticket has one arm done, its other arm is scheduled before any new pair starts, keeping arms as temporally close as the failure allowed.
- `--batch N` means "start at most N *new pairs* this invocation"; already-completed work never counts against it.

Rate-limit detection matches the documented `You've hit your … limit` message. The match is a best-effort optimization, not a correctness dependency: any abnormal session end that doesn't match is classified `error` and re-queued, so a changed message wording can never corrupt results. `--batch N` (default 10) bounds an evening's quota spend.

## Grading (`grade.ts`)

In a fresh container (no agent residue):

1. Check out `base_commit`, apply the agent's diff with `git apply --index --binary --whitespace=nowarn`. Fails to apply → **failed** (agent's fault, counted). An empty diff is not special-cased — it proceeds and fails the calibrated tests by construction.
2. Overlay **only the test files** from the real fix PR (`git checkout <fix_commit> -- <test_files>`).
3. Run `test_command` scoped to those test files. All pass → **passed**; any fail → **failed**.

**Calibration (pre-registered validity filter):** before any agent runs, every mined ticket is calibrated — its fix-PR tests must *fail* on the clean `base_commit` and *pass* on `fix_commit`, and every `test_files` path must exist at the same path in both commits (fix PRs that renamed/moved test files are excluded — the overlay would be ill-defined). Tickets failing calibration are excluded up front and the exclusion logged in `tickets/<repo>.json`. This proves each grading test actually discriminates the fix.

## Reporting (`report.ts`)

- `RESULTS.md`: per-repo table — tickets run, pass rate per arm, deltas; cost (`total_cost_usd` sums), turn and duration distributions; links to per-run artifacts.
- `METHODOLOGY.md`: eligibility criteria, contamination control, model pin, **single-run-per-ticket variance caveat**, **OSS-vs-enterprise gap caveat** (the personal 10%→80% anecdote stays an anecdote; the benchmark headline is whatever the benchmark says), and step-by-step reproduction including `claude setup-token`.
- Transcripts and diffs for every run published (release artifact or `runs/` snapshot) so each claimed result is inspectable.

## Error handling

- Infra failures (container crash, network, GitHub/Anthropic 5xx) → `error`, re-queued on resume, **never** counted as agent failures.
- Agent-attributable failures (diff doesn't apply, tests fail, max-turns/timeout hit) → `failed`, counted.
- Mining and grading are independently resumable; grading is re-runnable from stored diffs without re-running agents.

## Testing the harness

- Vitest unit tests with fixture data for: mining eligibility filters, checkpoint state transitions, grade decision logic, report rendering.
- End-to-end smoke test with a **fake `claude` binary** (shell script emitting a known diff + JSON envelope) over a tiny fixture repo — CI exercises the full pipeline with zero token spend.
- Live-run paths gated behind an env var, same convention as the repo's `TEST_LIVE_*` suites.

## Out of scope (YAGNI)

No LLM judge, no multi-model matrix (Sonnet only; optional Opus spot-check later), no parallel containers (sequential is the honest default under subscription rate limits), no Windows support, no hosted/CI execution of live runs.

## Open items

1. **Pilot repo** — candidate screening (Flask, Express, Django, Cal.com, Plane, Mastodon, FastAPI, Vitest) is running as a research workflow; its ranked shortlist picks the pilot and the final 3-repo mix. The design is repo-parameterized, so this blocks only the first `repos/<repo>.yaml`, not implementation.
2. **`--max-turns` value and container timeout** — set during pilot calibration; record whatever is chosen in `METHODOLOGY.md`.
