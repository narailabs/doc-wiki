# Troubleshooting

Common failures, diagnostics, and fixes. If you hit something not listed here, please open an issue at https://github.com/narailabs/doc-wiki/issues.

## Node version mismatch

**Symptom:** `npm install` fails with `Unsupported engine` or `error code EBADENGINE`. Or, after install, `npm run build` works but a script throws something like `Error: Cannot find module 'better-sqlite3'` at runtime.

**Cause:** doc-wiki pins `engines.node` to `>=20.0.0 <21.0.0` in [`package.json`](../package.json). Several native dependencies (`better-sqlite3`, `pdfjs-dist`, `mongodb`, `@aws-sdk/client-*`) ship prebuilt binaries that target Node 20 and won't load on Node 21+.

**Fix:**

```sh
node --version           # confirm what you're on
nvm install 20           # if you use nvm
nvm use 20
rm -rf node_modules package-lock.json
npm install
npm run build
```

If you don't use `nvm`, install Node 20 via your package manager (Homebrew: `brew install node@20`).

## `npm run build` fails

**Symptom:** `tsc -b tsconfig.build.json` exits non-zero with TypeScript errors.

**Common causes:**

1. **Stale `dist/` from an incompatible Node/TS version.** Fix: `rm -rf dist .tsbuildinfo && npm run build`.
2. **Missing dependency.** Fix: `rm -rf node_modules package-lock.json && npm install && npm run build`.
3. **You're editing on a feature branch where `package.json` is ahead of `node_modules`.** Fix: `npm install` first.

If `npm run typecheck` (which is `tsc --noEmit`) passes but `npm run build` fails, the issue is in `tsconfig.build.json`'s `include` list — usually a new `.ts` file under `skills/doc-wiki/scripts/` that wasn't picked up. Add it there.

## `gather()` returns empty plan

**Symptom:** During `/doc-wiki:ingest`, step 7 reports "no connectors planned" or `out.results.length === 0` even though the source clearly has external context (a Jira link, a GitHub URL, etc.).

**Diagnostic order:**

1. **Is the connector enabled?** Run:
   ```sh
   cat ~/.connectors/config.yaml
   ```
   The connector you expect (e.g., `jira`) should have `enabled: true` and a `skill` field set. Connectors are disabled by default in `.connectors/config.example.yaml`.

2. **Are credentials resolvable?** The hub doesn't fail loudly if `env:JIRA_API_TOKEN` is unset — it just drops the connector from the plan. Check:
   ```sh
   echo $JIRA_API_TOKEN     # must be non-empty
   ```
   For `keychain:` refs, confirm the entry exists (`security find-generic-password -s <label>` on macOS).

3. **Is the prompt mentioning the right entity?** The hub plans based on the `prompt` argument. If your source mentions only "the auth ticket" without an issue key, the planner has nothing to dispatch on. Step 6 of the ingest pipeline (entity extraction) populates the prompt — if your source is text-poor, `gather()` will plan nothing.

4. **Is the consumer overlay disabling the connector?** Check `consumers.doc-wiki` in your config. A common pattern is to disable AWS/GCP for wiki use only.

5. **Is the connector's CLI on PATH?** `narai-primitives` resolves CLIs in this order: `<NAME>_AGENT_CLI` env var → `~/.claude/plugins/cache/...` → `${CLAUDE_PLUGIN_DATA}/node_modules/...` → dev fallback. If none resolve, the planner will see the connector as enabled but fail to dispatch. The error appears in the result's `error.code`, e.g. `CLI_NOT_FOUND`.

## Live-DB tests skipped

**Symptom:** `npm test` shows "5 skipped" alongside the 934 passing tests, and you'd like to actually run them.

**Cause:** Five tests under `agents/lib/wiki_db/tests/` and `agents/lib/wiki_orm/tests/` exercise live database connections. They're gated behind `TEST_LIVE_*` env vars to avoid breaking CI.

**Fix:** Set the env vars matching the tests' expectations and re-run. The variable names are visible in the test source:

```sh
TEST_LIVE_SQLITE=1 npx vitest run agents/lib/wiki_db/tests/
```

Some tests need a real PostgreSQL or MySQL — provision one and set its connection string in the matching env var. Live DB tests are not required for any normal contribution; the 934 non-live tests cover the main paths.

## `/doc-wiki:lint` reports orphans or drift

**Symptom:** `/doc-wiki:lint` flags pages with broken links, content-hash drift on code references, or "isolated nodes" in the graph.

**Fix-first diagnostics:**

- **Broken link** — usually a renamed file. `/doc-wiki:lint --fix` repairs ones it can resolve unambiguously; the rest you fix by editing the page.
- **Code-ref drift** — the code at `path:lines` has changed since the wiki page was written. `/doc-wiki:edit <page> "re-extract from updated source"` lets you re-extract.
- **Orphan / isolated node** — page has no inbound or outbound links. Either the page was deleted from `wiki/` but lingered in `graph/edges.jsonl`, or it was never crosslinked. `/doc-wiki:lint --fix` removes stale edges; for the latter, run `/doc-wiki:ingest --no-cache` on the same source to re-trigger the crosslink pass.

See [`skills/doc-wiki/references/quality.md`](../skills/doc-wiki/references/quality.md) for the full lint rule list.

## Database connector denies a query I expected to allow

**Symptom:** A `db` connector call returns an envelope with `status: "denied"` (or `"escalate"` / `"present_only"`) when you expected `"ok"`.

**Cause:** The `db` connector ships with a guard-rail policy that classifies SQL by leading keyword (`SELECT` → read, `INSERT` → write, `DROP` → admin, …) and consults the rules in your config. The default-deny posture for unknown keywords is intentional.

**Fix:** Either:

1. **Rewrite the query** so it's classified the way you intend (e.g., wrap a CTE that begins with `WITH` in a `SELECT * FROM (…)`).
2. **Loosen the policy** in `.connectors/config.yaml` under `connectors.db.policy.<env>.<action>` — set to `allow`, but only if you understand the blast radius. Production environments should stay strict.

The full policy + outcomes are documented in [`docs/connectors.md`](connectors.md#db). Never commit `allow`-everything policies to a shared config.

## My hand-edits to a wiki page disappeared after `/doc-wiki:lint --fix`

**Symptom:** You edited `wiki/auth/jwt.md` to add a paragraph, ran `/doc-wiki:lint --fix`, and the paragraph is gone.

**Cause:** Your edit was inside an **auto-managed marker region**. doc-wiki uses two kinds of marker pairs:

- `<!-- wiki-mermaid: <name> start/end -->` — Mermaid blocks, regenerated by `mermaid_inject.ts`.
- `<!-- wiki-managed: <section> start/end -->` — sections owned by an agent (e.g. `summaries.md`'s entries, `wiki-claude-md-agent`'s output).

Anything inside these markers is overwritten on the next regeneration. Anything **outside** them is yours and survives.

**Fix:** Re-add your content **outside** any marker pair (above, below, or in a new section you create). For diff-reviewed targeted edits to auto-managed regions, use `/doc-wiki:edit <page-path> "<change description>"` instead of editing the file directly.

See [`wiki-output.md` § Editing pages by hand](wiki-output.md#editing-pages-by-hand) for the full survives-vs-overwritten matrix.

## `/doc-wiki:atlas` cost estimate is too high

**Symptom:** `/doc-wiki:atlas --dry-run` shows `Estimated cost: $487.00` and you don't want to spend that.

**Diagnostic order:**

1. **Narrow the facets.** The default facet set is `architecture,data-model,environments,api,operations`. Pick a subset: `/doc-wiki:atlas --facets architecture,data-model`. Re-runs are additive — a narrower run won't delete pages from a wider prior run.
2. **Narrow the scope.** `/doc-wiki:atlas --scope auth` restricts to one topic. Run multiple incremental scopes instead of one comprehensive pass.
3. **Lower `--max-cost`.** `/doc-wiki:atlas --max-cost 50` aborts pre-write if the estimate exceeds. Use `--dry-run` first to see the actual estimate.
4. **Add `--since` for re-runs.** On an existing wiki, `/doc-wiki:atlas --since 7d` only refreshes topics that have seen gitlog churn in the last week.
5. **Check the per-ingest baseline.** `atlas_orchestrator.js estimate-cost` rolls a per-ingest average from `log/events.jsonl`. If your average is high (large source files), fewer entries with `--scope` is the lever.

Atlas's full cost-and-cap section: [`atlas.md` § Cost and cap](atlas.md#cost-and-cap).

## `/doc-wiki:init` asked me to confirm a path I don't want

**Symptom:** Running `/doc-wiki:init` in your project, the orchestrator asks `Create wiki at docs/my-app-wiki? [Y/n]` and you wanted a different location.

**Cause:** `/doc-wiki:init` infers `docs/<app-name-kebab-case>-wiki/` from the project's marker file (`package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `pom.xml`) and asks you to confirm.

**Fix:** Either type a different path at the prompt (e.g. `wiki` or `internal-docs/wiki`) or pre-empt the inference at invocation:

```text
/doc-wiki:init --path /custom/path
```

Re-running is safe — `/doc-wiki:init` is idempotent and never overwrites existing files. If you scaffolded at the wrong location, `mv` the directory and update any `--wiki-root` flags or `wiki.config.yaml` references. The `.wiki-cache/` survives the move.

## `/doc-wiki:query` returns nothing useful

**Symptom:** Asking a question yields a vague answer or "no relevant pages found."

**Diagnostic order:**

1. **Is the wiki populated?** `/doc-wiki:stats --since 30d` should show ingest counts. If the wiki only has an `index.md`, you need more `/doc-wiki:ingest` runs first.
2. **Is `wiki/summaries.md` populated?** Each page should have a one-paragraph entry. If the file is sparse, run `/doc-wiki:lint --fix` to trigger `summaries_rebuild.ts`.
3. **Is your question phrased close to the source content?** Summary-first search scores against summaries, not full bodies — phrase your question with vocabulary that appears in source material.
4. **Try path mode** instead — if you're looking for relationships between concepts (`/doc-wiki:query --from auth --to session`), the graph traversal is more direct than summary-first synthesis.

## Where to file issues

- Bugs and feature requests: https://github.com/narailabs/doc-wiki/issues
- Connector-specific issues (e.g., a `narai-primitives` connector misbehaving): https://github.com/narailabs/narai-primitives/issues
- Credential-provider issues: https://github.com/narailabs/credential-providers/issues

When filing, please include:

- Your Node version (`node --version`)
- Output of `npm test` (passes? regressions?)
- Sanitized excerpt of `~/.connectors/config.yaml` (redact tokens)
- Last few entries of `log/events.jsonl` if the failure was during a `/doc-wiki:*` op

## Migration: where did `<old command>` go?

### `/doc-wiki:onboard`

Folded into `/doc-wiki:init`. On a wiki that's already initialized, re-running `/doc-wiki:init` prompts "Wiki already initialized. Re-run onboarding?" — choose yes to re-run the same flow the old `/doc-wiki:onboard` ran.

### `/doc-wiki:refresh`

Folded into `/doc-wiki:ingest --refresh [--source <s> | --all]`. `--source <s>` re-fetches a single previously-ingested source; `--all` re-fetches every source in `log/events.jsonl`.

### `/doc-wiki:promote`

Folded into `/doc-wiki:query`:
- Single-file promote: `/doc-wiki:query --promote <file|last|N>`. After a synthesis-mode `/doc-wiki:query` answers your question, you're also prompted "Save this answer as a permanent wiki page?" — accepting that prompt runs the same promote flow on the just-written archive.
- Bulk review: `/doc-wiki:query --review [--since <dur>] [--limit <N>] [--topic <dir>]`.

### `/doc-wiki:fix`

Renamed to `/doc-wiki:edit`. The behavior is identical — the name was changed because the command modifies a page for any reason (not just fixing broken state), and the old name collided semantically with `/doc-wiki:lint`'s auto-heal mode.
