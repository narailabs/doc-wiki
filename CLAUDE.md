# doc-wiki

Documentation wiki generator and maintainer. Runs entirely inside Claude Code as skills + agents + TypeScript helper scripts.

## Architecture

- **Main skill:** `.claude/skills/wiki/SKILL.md` — orchestrates all `/wiki-*` commands
- **Slash-command wrappers:** `.claude/commands/wiki-*.md` — 10 thin wrappers so `/wiki-init`, `/wiki-onboard`, etc. appear in Claude Code's slash-command autocomplete and route into the skill
- **Source-fetch dispatch:** `/wiki-ingest` step 7 calls `gather()` from `@narai/connector-hub`, which plans and spawns the underlying `@narai/*-agent-connector` CLIs in parallel. The wiki-side Mermaid augmentation runs on the raw envelopes via `.claude/agents/lib/mermaid_augment.ts`. There is **one path**: gather → applyMermaid. The legacy `wiki-<svc>-agent` subagents + their per-service wrappers were decommissioned — their CLI-resolution and Mermaid responsibilities are now wholly owned by `connector-hub` and `mermaid_augment.ts`.
- **No standalone CLI** — all LLM calls go through Claude Code's session
- **Runtime:** Node 20. All scripts are TypeScript; `npm run build` emits sibling `.js` files that are invoked with `node`.

### Slash commands (10) — `.claude/commands/`

Thin wrappers so each documented `/wiki-*` subcommand is discoverable in Claude Code's slash-command autocomplete. Each wrapper invokes the `wiki` skill with the matching subcommand and passes `$ARGUMENTS` through. Files: `wiki-init.md`, `wiki-onboard.md`, `wiki-ingest.md`, `wiki-query.md`, `wiki-lint.md`, `wiki-fix.md`, `wiki-promote.md`, `wiki-refresh.md`, `wiki-path.md`, `wiki-stats.md`.

### TypeScript scripts (11) — `.claude/skills/wiki/scripts/`

Deterministic operations: hashing, parsing, graph ops, lint, security.

| Script | Purpose |
|--------|---------|
| `init_wiki.ts` | Scaffold wiki directory structure and config |
| `parse_config.ts` | Read and validate `wiki.config.yaml` |
| `event_logger.ts` | Append structured events to `events.jsonl` |
| `graph_ops.ts` | Relationship graph queries (paths, clusters, orphans) |
| `lint_checks.ts` | Frontmatter and link validation |
| `quality_score.ts` | Per-page and aggregate quality scoring |
| `cache_manager.ts` | Content-hash cache for incremental processing |
| `daily_summary.ts` | Generate daily digest of wiki changes |
| `extract_binary.ts` | Extract text from binary files (PDF, DOCX, etc.) |
| `mermaid_lint.ts` | Validate Mermaid diagram syntax |
| `security_check.ts` | URL validation, path containment, input sanitization |

### Agents (3) — `.claude/agents/`

External-source fetching is handled by `@narai/*-agent-connector` packages dispatched through `@narai/connector-hub`'s `gather()` — there are no per-service subagents in doc-wiki. The remaining agents do wiki-specific derivation that has nothing to do with the connector workspace:

| Agent | Purpose |
|-------|---------|
| `wiki-claude-md-agent` | Generate project `CLAUDE.md` from wiki pages |
| `wiki-mermaid-agent` | Generate Mermaid architecture diagrams |
| `wiki-orm-agent` | ORM model detection and entity-to-table mapping (uses `wiki_db` to cross-validate schemas) |

### Shared libraries (2) — `.claude/agents/lib/`

| Library | Purpose |
|---------|---------|
| `wiki_db` | Connection / driver / policy code reused by `wiki-orm-agent` for schema cross-validation. Originally extracted from the now-deleted `wiki-db-agent` wrapper; the connector-side policy gate lives in `@narai/db-agent-connector`. |
| `wiki_orm` | ORM mapper with 7 profiles: SQLAlchemy, Django, JPA, Prisma, TypeORM, ActiveRecord, Entity Framework |

ORM profile definitions ship as YAML files under `.claude/agents/lib/wiki_orm/profiles/*.yaml` and are loaded by the TypeScript mapper at runtime.

Standalone helpers still live at `.claude/agents/lib/` (flat files, no subdirectory):

| Helper | Purpose |
|--------|---------|
| `source_registry.ts` | Source-to-connector matching (URL/scheme → connector ID). Builtin patterns are a static list of 7 connectors (jira, confluence, github, notion, aws, gcp, db). Custom patterns load from `wiki.config.yaml` `ecosystem.agents.custom`. Used by `how_to_go_deeper.ts` (ingest step 10) for cross-link classification — never dispatches connector calls. |
| `parse_config.ts` | Read and validate `wiki.config.yaml` (shared with skills) |
| `mermaid_format.ts` | Mermaid diagram formatting utilities |
| `mermaid_augment.ts` | Apply wiki-specific `mermaid: { type, title, code }` blocks on top of raw `DispatchResult` envelopes returned by `@narai/connector-hub`'s `gather()`. Used by `/wiki-ingest` step 7. Single decoration site for all 7 connectors. |

Vendor-neutral connector helpers now ship as npm packages and are consumed directly:

| Package | Purpose |
|---------|---------|
| `@narai/connector-hub` | `gather({ prompt, consumer })` — plans + parallel-dispatches read-only connector calls. Drives `/wiki-ingest` step 7. |
| `@narai/connector-toolkit` | `parseAgentArgs`, `fetchWithCaps`, `validateUrl`, `checkPathContainment`, `sanitizeLabel` — the CLI, fetch, and security primitives shared by every source agent. Lives at `~/src/connector-toolkit/` during dev. |
| `@narai/credential-providers` | Env-var, keychain, file, and cloud-secret-manager providers; `resolveSecret`, `registerProvider`, `CredentialResolver`. Published to npm; installed as a regular dep. |

### Reference docs (5) — `.claude/skills/wiki/references/`

| Document | Topic |
|----------|-------|
| `autonomy.md` | Agent autonomy levels and escalation |
| `code-locality.md` | Code-aware wiki page placement |
| `compilation.md` | Wiki compilation and build pipeline |
| `operations.md` | Operational runbooks and maintenance |
| `quality.md` | Quality scoring rubric and thresholds |

### Multi-platform wrappers

The wiki skill is accessible from multiple AI coding tools via wrapper files:

| File | Platform |
|------|----------|
| `AGENTS.md` | Codex / OpenAI agents |
| `GEMINI.md` | Gemini / Google AI |
| `.cursor/rules/wiki.mdc` | Cursor IDE |
| `.aider/conventions.md` | Aider |

## Design reference

Full v2 design: `/Users/narayan/research/doc-wiki/ideal-wiki-skill-report-v2.md`
Implementation plan: `/Users/narayan/.claude/plans/reactive-toasting-tulip.md`
Python-to-TypeScript migration plan: `/Users/narayan/.claude/plans/synthetic-leaping-truffle.md`

## Setup

Requires Node 20. Install and build once:

```bash
npm install
npm run build
```

## Testing

All tests use Vitest.

| Suite | Command |
|-------|---------|
| Wiki scripts | `npx vitest run .claude/skills/wiki/scripts/tests/` |
| wiki_db library | `npx vitest run .claude/agents/lib/wiki_db/tests/` |
| ORM mapper | `npx vitest run .claude/agents/lib/wiki_orm/tests/` |
| CLAUDE.md gen | `npx vitest run .claude/agents/wiki-claude-md-agent/scripts/tests/` |
| Mermaid gen | `npx vitest run .claude/agents/wiki-mermaid-agent/scripts/tests/` |
| **Full suite** | `npm test` (alias for `vitest run`) |
| Typecheck | `npm run typecheck` |
| Build | `npm run build` |
| Skills/agents | `/skill-creator` evals |

Current status: **878 tests passed, 5 skipped (live-DB integration tests, gated behind `TEST_LIVE_*` env vars)**.

## Key conventions

- Standard markdown links for all wiki navigation (NOT wikilinks)
- `edges.jsonl` for typed relationship metadata (supports, contradicts, extends, supersedes)
- Provenance tags on every edge (EXTRACTED / INFERRED / AMBIGUOUS)
- Content-only concept tags (no structural/temporal/metadata tags)
- Security Baseline: URL validation, path containment, size/timeout caps, label sanitization
- Guard-rail policy for database agent: ALLOW / DENY / ESCALATE / PRESENT_ONLY
- No Python in this repo. To verify: `find . -name '*.py' -not -path './node_modules/*' -not -path './wiki-workspace/*' -not -path './.worktrees/*/node_modules/*'` should return only the ORM extractor fixture source files under `.claude/agents/lib/wiki_orm/tests/fixtures/{sqlalchemy,django}/` (input data read as text by TypeScript tests).

## Architecture contracts

Load-bearing invariants implementers must respect:

- **Database drivers implement `executeReadAsync(conn, sql, params, maxRows, timeoutMs): Promise<ExecuteReadResult>`.** There is no sync `execute` path. Sync drivers (e.g. SQLite's `executeRead`) are adapted at the call site via `adaptDriver` (used by `wiki-orm-agent` and the `wiki_db` library tests).
- **`getConnection(envName)` is async.** Callers must `await` it. `release` and `shutdown` use identity-based lookup on the awaited handle.
- **Single source-fetch path through `gather()`.** `/wiki-ingest` step 7 calls `gather()` from `@narai/connector-hub`; doc-wiki does not maintain per-service subagents or wrappers. The hub owns CLI resolution, parallel dispatch, and per-step error isolation; `mermaid_augment.ts` owns wiki-specific decoration.
- **Credential resolution uses the published package.** Import `resolveSecret`, `registerProvider`, and provider classes from `@narai/credential-providers` (not from a local path). Connectors load their own credentials inside the connector process — doc-wiki does not pass credentials into `gather()`.
- **ORM profile patterns are validated at load time.** `loadProfile` compiles every regex-valued pattern; a bad pattern throws `ProfileValueError` with the file path and offending pattern.
- **Source-to-connector matching is data-driven.** `lookupBySource()` from `.claude/agents/lib/source_registry.ts` reads a static `BUILTIN_PATTERNS` list (one entry per known `@narai/<id>-agent-connector`). Custom patterns load via `ecosystem.agents.custom` in `wiki.config.yaml` — no code changes needed to add a new connector mapping. `lookupBySource` never dispatches a connector; it only classifies sources for `how_to_go_deeper.ts`.
