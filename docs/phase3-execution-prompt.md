# Phase 3 Execution Prompt — Sequential, Per-Step, Opus Agents (3-Layer Distribution)

Paste everything below into a new Claude Code session. The session you paste into is the **orchestrator**: it does not write code itself — it spawns one Opus agent per step, in strict sequential order, and waits for each to complete before dispatching the next.

---

## Orchestration contract

You are the orchestrator for Phase 3 of the doc-wiki project. The full plan lives at:

```
/Users/narayan/src/doc-wiki/docs/phase3-source-agents-extraction-prompt.md
```

Read that file in full before doing anything else. It is the authoritative spec. The plan describes a **3-layer distribution model**:

- **Layer 1** — `@narai/*` npm packages (vendor-neutral, no Claude Code awareness).
- **Layer 2** — Per-connector Claude Code plugins (one per platform) that wrap the matching Layer 1 npm package via SKILL.md (`context: fork`) + slash command + SessionStart hook.
- **Layer 3** — doc-wiki integration via wrapper agents with a 4-step resolver (env var → Layer 2 plugin cache → `${CLAUDE_PLUGIN_DATA}` → `~/src/` dev fallback).

### Rules you must follow

1. **You write no code.** Every implementation step is delegated to an `Agent` call with `subagent_type: "general-purpose"` and `model: "opus"`. You only orchestrate, verify, and report.
2. **Strict sequential execution.** Never spawn more than one implementation agent at a time. Always wait for the current agent to finish before spawning the next.
3. **Per-platform vertical slice.** After Phase 3a (toolkit), all 6 sub-steps for one platform must complete before the next platform starts. Order: aws → gcp → notion → confluence → jira → github.
4. **Verify after every agent.** After each agent reports completion, run a short verification (typecheck, test, file existence — whatever the step calls for) yourself. If verification fails, stop and report — do not start the next agent.
5. **Each agent gets a self-contained prompt.** Spawned agents do not see this conversation. Every prompt you write must include: the path to the plan doc, the specific step number + heading from the plan, the layer being touched (Layer 1/2/3), the exact files to touch, what success looks like, and what to report back.
6. **Each agent's prompt ends with the same reporting clause:** "When done, report back: (1) files created/modified with absolute paths, (2) exact test command run + result, (3) any deviations from the plan and why, (4) anything blocked." Keep agent responses tight — under 300 words each.
7. **All implementation agents use `model: "opus"`.** Set this explicitly on every `Agent` call.
8. **Stop conditions.** Stop and ask the user if: (a) verification fails after an agent, (b) an agent reports it cannot proceed, (c) you discover the plan is internally inconsistent for the step ahead, (d) a step would touch shared/production systems beyond the local repos. Do not improvise around these.
9. **Progress tracking.** Use `TaskCreate` / `TaskUpdate` to track all 42 implementation tasks below. Mark `in_progress` when you spawn the agent, `completed` when its verification passes, `failed` if blocked.
10. **No git pushes, no npm publishes.** This phase is dev-fallback only. If an agent suggests publishing or pushing, push back and skip that part.
11. **Layer 1/2 packages must not import doc-wiki.** During verification of Layer 1 sub-steps, grep the connector repo for `doc-wiki`, `wiki-`, `summaries`, `edges` — none should appear. Same for Layer 2 plugin code (SKILL.md, slash command, hooks).
12. **Branch per logical chunk in doc-wiki.** Phase 3a (toolkit consumption) gets one branch. Each of the six platform vertical slices gets its own branch in doc-wiki for the Layer 3 changes. Branch naming: `phase3a-connector-toolkit`, `phase3-aws`, `phase3-gcp`, `phase3-notion`, `phase3-confluence`, `phase3-jira`, `phase3-github`, `phase3-finalization`. Connector and plugin repos under `~/src/` have their own independent histories.

### Per-agent dispatch template

Every agent invocation looks like this:

```
Agent({
  subagent_type: "general-purpose",
  model: "opus",
  description: "<5-word task summary>",
  prompt: `
Read the Phase 3 plan first:
  /Users/narayan/src/doc-wiki/docs/phase3-source-agents-extraction-prompt.md

Your task corresponds to:
  Layer: <1 / 2 / 3>
  Step: <STEP HEADING from the plan>

Scope of your work:
  <bulleted, file-level instructions specific to this step>

Constraints:
  - Read-only on every external service.
  - No npm publish, no git push.
  - Layer 1 and Layer 2 code must not import doc-wiki or reference its concepts.
  - Match the existing code style of the target repo (TypeScript, ESM, vitest).
  - All new code paths must have tests added.

Success criteria:
  <verifiable list — specific files exist, specific tests pass, specific output produced>

When done, report back:
  (1) files created/modified with absolute paths,
  (2) exact test command run + result,
  (3) any deviations from the plan and why,
  (4) anything blocked.

Keep your reply under 300 words.
  `
})
```

---

## Execution sequence (42 steps total)

Spawn one agent per numbered step below, in order. Wait for each, verify, then continue. Do not batch.

### Phase 3a — Connector Toolkit (3 steps)

**Step 1 — Layer 1 scaffold (`@narai/connector-toolkit`).** Scaffold `~/src/connector-toolkit/`. Create the repo skeleton: `package.json` (name `@narai/connector-toolkit`, `type: module`, Node 20+), `tsconfig.json`, `vitest.config.ts`, `README.md`, empty `src/` and `tests/` dirs. Initialize git. Verify: `npm install` succeeds in the new repo.

**Step 2 — Move shared helpers into the toolkit.** Copy `_agent_cli.ts`, `fetch_helper.ts`, `security_check.ts`, `parse_config.ts`, and `credential_providers/*.ts` from `/Users/narayan/src/doc-wiki/.claude/agents/lib/` into `~/src/connector-toolkit/src/` (rename `_agent_cli.ts` → `agent_cli.ts`). Adjust imports. Move the corresponding tests into `~/src/connector-toolkit/tests/`. Verify: `npm test` in the toolkit repo passes.

**Step 3 — Make doc-wiki consume `@narai/connector-toolkit`.** Add it as a `file:` or `link:` dependency in doc-wiki's `package.json`. Replace every internal import that referenced the moved helpers with imports from the toolkit. Delete the now-duplicated files in `.claude/agents/lib/` (keep them only if any non-source-agent script still uses them — flag any such case for the orchestrator). Verify: `npm test` and `npm run typecheck` in doc-wiki both pass.

### Phase 3b — Per-Platform Vertical Slices (6 steps × 6 platforms = 36 steps)

For each platform in this order — `aws`, `gcp`, `notion`, `confluence`, `jira`, `github` — execute Sub-steps S1–S6 sequentially. Do not start the next platform until all 6 sub-steps for the current one are green.

**Sub-step S1 — Layer 1 scaffold (`@narai/<service>-agent-connector`).** Scaffold `~/src/<service>-agent-connector/` per the Layer 1 layout in the plan. `package.json` declares `@narai/connector-toolkit` as a dependency and adds platform SDK packages as `optionalDependencies`. Initialize git. Verify: `npm install && npm run build` succeed.

**Sub-step S2 — Layer 1 copy + adapt code.** Copy `<service>_fetch.ts` from `.claude/agents/wiki-<service>-agent/scripts/` into the connector as `src/cli.ts` (strip the Mermaid import + the lines that attach `mermaid` to responses). Copy `scripts/lib/*.ts` → `src/lib/`. Replace previously-vendored helpers with imports from `@narai/connector-toolkit`. Move tests. Add Markdown converter library if applicable (see plan's per-platform notes). Verify: `npm test && npm run typecheck` in the connector repo pass; grep the repo for `doc-wiki` / `wiki-` references — none should remain.

**Sub-step S3 — Layer 1 add comment/attachment actions.**
  - **AWS / GCP:** no-op per plan. Mark task complete with note: "no-op per plan".
  - **Notion / Confluence / Jira / GitHub:** implement the new actions per the per-platform scope tables in the plan. Each action gets a unit test (mocked), an integration test (nock replay of recorded fixture), and an opt-in live test gated by `TEST_LIVE_<PLATFORM>=1`. Add to `VALID_ACTIONS`. For `get_attachment`: validate `dest_path` via `securityCheck.pathContainment`, stream to disk, default 100 MB cap with `--max-size-mb` up to 500 MB. For Notion, support `--url-only`. Verify: `npm test` in the connector repo passes (live tests skipped); new actions exercisable from the CLI with a stubbed HTTP layer.

**Sub-step S4 — Layer 2 plugin scaffold (`<service>-agent-plugin`).** Scaffold `~/src/<service>-agent-plugin/` per the Layer 2 layout in the plan. Create `.claude-plugin/plugin.json`, the runtime `package.json` declaring `@narai/<service>-agent-connector` as a dep, the `bin/<service>-agent` POSIX shim, and `hooks/hooks.json` with the SessionStart one-liner from the plan. Initialize git. Verify: `node -e "require('./.claude-plugin/plugin.json')"` parses without error; `bash bin/<service>-agent --help` (with `CLAUDE_PLUGIN_DATA` pointing at a temp dir where the npm package is installed) returns a help screen.

**Sub-step S5 — Layer 2 SKILL + slash command.** Author `skills/<service>-agent/SKILL.md` with `context: fork` and a description that triggers on platform-specific queries (must NOT mention doc-wiki — it stands alone). Author `commands/<service>-agent.md` with `argument-hint` and a single short prompt that delegates to the skill. Add a basic README documenting standalone use. Verify: install the plugin into a scratch Claude Code workspace (use `mkdir -p /tmp/scratch-<service> && cd /tmp/scratch-<service> && claude --plugins ~/src/<service>-agent-plugin`) and confirm the slash command appears; grep the plugin for `doc-wiki` / `wiki-` — none should appear.

**Sub-step S6 — Layer 3 doc-wiki wrapper.** In doc-wiki, replace `.claude/agents/wiki-<service>-agent/scripts/<service>_fetch.ts` with `<service>_wrapper.ts` from the Layer 3 template (4-step resolver: env var → plugin cache → `${CLAUDE_PLUGIN_DATA}` → `~/src/` dev fallback). Add `@narai/<service>-agent-connector` to doc-wiki's `package.json` as an `optionalDependency`. Update `wiki-<service>-agent/AGENT.md` with the new "Architecture" section showing the 4-step resolver. Bump `version` patch (minor if listing new actions). Add wrapper smoke tests (mock the spawned subprocess). Run end-to-end smoke: with the Layer 1 npm package built and the Layer 2 plugin installed in a scratch workspace, exercise the wrapper against a stubbed (or real if creds available) action and confirm the output envelope includes the `mermaid` field for structural responses. Verify: `npm test && npm run typecheck` in doc-wiki pass; the source registry CLI still lists 10 agents.

> **Per-platform sub-step counts in the task tracker:**
> - aws: S1, S2, S3 (no-op), S4, S5, S6 → 6 numbered task entries
> - gcp: same → 6
> - notion: S1, S2, S3 (3 new actions), S4, S5, S6 → 6
> - confluence: same shape → 6
> - jira: same shape → 6
> - github: S1, S2, S3 (4 new actions), S4, S5, S6 → 6
>
> Total Phase 3b = 36 steps.

### Phase 3c — Finalization (3 steps)

**Step F1 — `wiki.config.yaml` schema.** Update `parse_config.ts` to support an optional per-agent `connector_path` override (consulted as a step 0 in the wrapper resolver). Add tests. Verify: `npm test` in doc-wiki passes; `node .claude/agents/lib/source_registry.js list` still lists all 10 agents.

**Step F2 — Documentation refresh.** Update `/Users/narayan/src/doc-wiki/docs/architecture-sources-and-agents.md`:
- §3 sub-sections: note the 3-layer model and the new comment/attachment actions per agent.
- §5: extend the db-agent wrapper-pattern coverage to mention all source agents now share the model (and `db-agent-connector` will be retrofitted in Phase 3.5).
- Add a new §11.5 listing all 7 npm packages and 6 Layer 2 plugins.

Update root `CLAUDE.md` to add the new env vars (`AWS_AGENT_CLI`, `GCP_AGENT_CLI`, `NOTION_AGENT_CLI`, `CONFLUENCE_AGENT_CLI`, `JIRA_AGENT_CLI`, `GITHUB_AGENT_CLI`) under "Architecture contracts", and note the 4-step resolver order.

Verify: `node .claude/skills/wiki/scripts/lint_checks.js` reports no broken refs; cited paths in the architecture doc exist on disk.

**Step F3 — Final test sweep.**
- `node .claude/agents/lib/source_registry.js list` shows 10 agents.
- `npm test` in doc-wiki: at or above the 1025/5 baseline (no regressions).
- `npm test` in each of the 7 connector repos green.
- `npm test` (or skill smoke) in each of the 6 plugin repos green.
- Each Layer 2 plugin loads in a scratch Claude Code workspace and its slash command appears.

---

## Final orchestrator report

After Step F3 verifies green, produce a final report containing:

- Total agents dispatched (expected: 42).
- Per-step status table (step #, layer, description, files modified count, test result).
- All 13 repo paths: `~/src/connector-toolkit/`, `~/src/<service>-agent-connector/` × 6, `~/src/<service>-agent-plugin/` × 6.
- Final test counts in doc-wiki vs the baseline (currently 1025 passed + 5 skipped).
- Any deviations from the plan, with rationale.
- Suggested next steps (Phase 3.5: retrofit `db-agent-connector` to 3-layer; Phase 4: npm publish under `@narai/*` and marketplace listing for the 6 plugins).

Do not push, publish, or merge anything. Hand off to the user for review.

---

## Begin

Read the plan doc, create the 42 tasks via `TaskCreate`, then dispatch Step 1's agent.
