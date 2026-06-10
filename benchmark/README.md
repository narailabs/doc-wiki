# doc-wiki benchmark

Reproducible measurement of Claude Code's ticket-fix pass rate, baseline vs with a doc-wiki wiki.
Design: [`docs/superpowers/specs/2026-06-10-benchmark-harness-design.md`](../docs/superpowers/specs/2026-06-10-benchmark-harness-design.md).
Methodology and caveats: [`METHODOLOGY.md`](METHODOLOGY.md). Numbers: `RESULTS.md` (generated; committed when pilot runs complete).

## One-time setup

1. `claude setup-token` → export the printed token as `CLAUDE_CODE_OAUTH_TOKEN` (draws on your Claude subscription; never commit it).
2. Build the image: `docker build -t docwiki-bench-vitest --build-arg TOOLCHAIN=node:22 benchmark/harness/docker/`
3. Cache a bare clone: `git clone --bare https://github.com/vitest-dev/vitest.git benchmark/wiki-cache/vitest.git`

## Pipeline (pilot: vitest)

| step | command |
|---|---|
| mine tickets | `npm run benchmark -- mine --repo vitest --target 30` |
| set `wiki_commit` | parent of the oldest `base_commit` in `benchmark/tickets/vitest.json` → `benchmark/repos/vitest.yaml` |
| build wiki overlay | `npm run benchmark -- build-wiki --repo vitest --plugin-dir .` |
| calibrate | `npm run benchmark -- calibrate --repo vitest` (runs on the HOST — needs the repo toolchain, e.g. node+pnpm for vitest) |
| run a batch (both arms) | `npm run benchmark -- run --repo vitest --batch 10` |
| grade | `npm run benchmark -- grade --repo vitest` |
| report | `npm run benchmark -- report --repo vitest` |

Hitting your subscription's rate limit mid-batch is expected: the run stops, prints the reset time, and the same `run` command resumes exactly where it left off (completing half-finished pairs first, reusing any completed-but-unrecorded session artifacts at zero spend).

Artifacts land in `benchmark/runs/<repo>/<issue>/<arm>/` (gitignored): `prompt.txt`, `result.json`, `diff.patch`, `transcript/` (credential-pruned + token-redacted), `grade.json`. The checkpoint lives at `benchmark/runs/<repo>/state.json`.

## Performance notes

- Every grade/calibration run pays the repo's full `install` (for vitest: `pnpm install` + build, minutes each) inside a fresh clone. For long sweeps, mount a persistent pnpm store into the grade container (`-e PNPM_STORE_DIR` + a volume) or run grading overnight; install caching is deliberately not built into V1 of the harness to keep grading hermetic.
- Containers are named `bench-<repo>-<issue>-<arm>`; a crashed harness never leaks runaway containers (each run pre-cleans its name and reaps on failure), but `docker ps` is your friend after a hard kill.

## Salvaged V1 inputs

- [`repos.yaml`](repos.yaml) — hand-curated 25-issue manifest (django / cal.com / mastodon), SHAs verified in [`results/curation-report.md`](results/curation-report.md). Input for the V2 full-mix phase (django needs the `trac-commits` mining adapter, not yet implemented).
- [`PLAN.md`](PLAN.md), [`ANALYSIS.md`](ANALYSIS.md), [`PUBLISH.md`](PUBLISH.md), [`dispatch.md`](dispatch.md) — superseded V1 strategy docs (see their banners).
