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
- **Code-ref drift** — the code at `path:lines` has changed since the wiki page was written. `/doc-wiki:fix <page>` lets you re-extract.
- **Orphan / isolated node** — page has no inbound or outbound links. Either the page was deleted from `wiki/` but lingered in `graph/edges.jsonl`, or it was never crosslinked. `/doc-wiki:lint --fix` removes stale edges; for the latter, run `/doc-wiki:ingest --no-cache` on the same source to re-trigger the crosslink pass.

See [`skills/doc-wiki/references/quality.md`](../skills/doc-wiki/references/quality.md) for the full lint rule list.

## Database connector denies a query I expected to allow

**Symptom:** A `db` connector call returns an envelope with `status: "denied"` (or `"escalate"` / `"present_only"`) when you expected `"ok"`.

**Cause:** The `db` connector ships with a guard-rail policy that classifies SQL by leading keyword (`SELECT` → read, `INSERT` → write, `DROP` → admin, …) and consults the rules in your config. The default-deny posture for unknown keywords is intentional.

**Fix:** Either:

1. **Rewrite the query** so it's classified the way you intend (e.g., wrap a CTE that begins with `WITH` in a `SELECT * FROM (…)`).
2. **Loosen the policy** in `.connectors/config.yaml` under `connectors.db.policy.<env>.<action>` — set to `allow`, but only if you understand the blast radius. Production environments should stay strict.

The full policy + outcomes are documented in [`docs/connectors.md`](connectors.md#db-connector). Never commit `allow`-everything policies to a shared config.

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
