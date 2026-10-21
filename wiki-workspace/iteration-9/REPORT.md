# Iteration 9 — narai-primitives@2.1.0 migration regression check

Generated 2026-05-03. Ran all four eval suites end-to-end against the published `narai-primitives@2.1.0` (no symlinks, real npm install).

## Headline

- **24 evals run, 161 / 163 expectations pass (98.8 %)**
- 22 evals at 100 %; 2 evals with 1 failed expectation each
- **Both failures are independent of the credential-providers absorption** — one is a pre-existing `graph_ops.js` CLI output behavior, the other is an internally-inconsistent eval prompt
- **Migration verdict: clean**

## Per-suite breakdown

| Suite | Evals | Expectations | Pass rate | Wall time |
|---|---|---|---|---|
| `skills/doc-wiki` (main) | 13 | 91 / 93 | 97.8 % | ~26 min |
| `agents/wiki-orm-agent` | 5 | 34 / 34 | 100 % | ~7 min |
| `agents/wiki-mermaid-agent` | 4 | 24 / 24 | 100 % | ~4 min |
| `agents/wiki-claude-md-agent` | 2 | 12 / 12 | 100 % | ~3 min |
| **Total** | **24** | **161 / 163** | **98.8 %** | parallel — ~26 min wall |

## Per-eval results

| Eval | Pass | Suite |
|---|---|---|
| wiki-init-ingest-query | 12/12 | doc-wiki |
| wiki-lint | 6/6 | doc-wiki |
| wiki-path | **7/8** | doc-wiki |
| wiki-onboard-spring-boot-postgres | 6/6 | doc-wiki |
| wiki-onboard-django-mongo | 6/6 | doc-wiki |
| wiki-ingest-folder | 7/7 | doc-wiki |
| wiki-fix | 6/6 | doc-wiki |
| wiki-stats-by-op | 6/6 | doc-wiki |
| wiki-promote | 7/7 | doc-wiki |
| wiki-refresh | 7/7 | doc-wiki |
| wiki-query-multi-page | 7/7 | doc-wiki |
| wiki-stats-since | **6/7** | doc-wiki |
| wiki-onboard-node-pg | 8/8 | doc-wiki |
| orm-agent-jpa | 8/8 | orm |
| orm-agent-custom | 6/6 | orm |
| orm-agent-sqlalchemy | 6/6 | orm |
| orm-agent-prisma | 7/7 | orm |
| orm-agent-typeorm | 7/7 | orm |
| claude-md-agent-multi-submodule | 6/6 | claude-md |
| claude-md-agent-preserve-manual | 6/6 | claude-md |
| mermaid-agent-er | 6/6 | mermaid |
| mermaid-agent-flowchart | 6/6 | mermaid |
| mermaid-agent-sequence | 6/6 | mermaid |
| mermaid-agent-class | 6/6 | mermaid |

## Failed expectations (both unrelated to the migration)

### `wiki-path` 7/8 — `graph_ops.js path` no-path output

- **Expectation**: "A no-path query (unreachable or unknown target) returns an empty result with a human-readable explanation — not a stack trace or bare `[]`"
- **Actual**: `graph_ops.js path --from authentication --to does-not-exist` exits 0 and writes literal `[]` to stdout. No explanation string.
- **Source**: pre-existing CLI output format in `skills/doc-wiki/scripts/graph_ops.js:564-566`. Not touched by the migration.
- **Action**: out of scope for this regression check; could be filed as a small UX improvement separately.

### `wiki-stats-since` 6/7 — eval prompt is self-contradictory

- **Expectation**: "`--since 30d` returns `total_events=9`"
- **Actual**: stats output for `--since 30d` is `total_events=5`
- **Why**: the eval prompt's own setup conflicts with its expected counts. It says one cohort is "20 days ago" but anchors it to `2026-03-25`. Today is `2026-05-03`, which is **39 days** after `2026-03-25` — outside the 30-day window. The script filters correctly; the eval's expected number was computed against the "20 days ago" phrasing, not the literal date.
- **Source**: `skills/doc-wiki/evals/evals.json` eval id 12 prompt text. The script's behavior is correct.
- **Action**: out of scope for this regression check; the eval's prompt should be updated to use a relative-time anchor or recompute the expected count.

## Independent migration sanity check

The runner verified both import paths resolve cleanly:

- `import('narai-primitives')` → hub surface (`gather`, `dispatchPlan`, `AgentSdkPlanner`, …) ✓
- `import('narai-primitives/credentials')` → credentials surface (`resolveSecret`, `registerProvider`, `CredentialResolver`, four provider classes, …) ✓

`node_modules/narai-primitives/package.json` reports `"version": "2.1.0"` (real install, not a symlink).

## Coverage caveat

None of the 13 doc-wiki main evals invoke `gather()` at `/doc-wiki:ingest` step 7 (which is the production call site that spawns connector subprocesses and resolves credentials inside them). That boundary is exercised by the `narai-primitives` test suite (1563 passed, 26 skipped behind `TEST_LIVE_*` env vars) plus the doc-wiki unit tests (1129 passed, 5 skipped). The skill-level evals confirm the wiki workflows still function and the credentials subpath is reachable; for live-connector regression coverage, run an actual `/doc-wiki:ingest <github-url>` against a real source.

## Source of truth

Per-eval grading lives at `wiki-workspace/iteration-9/<eval-name>/with_skill/run-1/grading.json` (24 files). Outputs (generated wiki pages, detected-entities.json, mermaid-lint.txt, etc.) live at the corresponding `with_skill/outputs/` directories.
