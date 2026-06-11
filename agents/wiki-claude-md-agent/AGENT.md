---
name: wiki-claude-md-agent
description: |
  Maintainer for AI-tool root files (CLAUDE.md, AGENTS.md, GEMINI.md,
  .cursor/rules/doc-wiki.mdc, .aider/conventions.md) and the per-tool
  configuration registry under `docs/<wiki-folder>/ai-dev/`. Generates and
  updates wiki-managed sections that stay in sync with the wiki. Preserves
  user-written content outside managed markers. Handles root-level files
  plus per-submodule CLAUDE.md with parent/child cross-links.
type: maintenance
autonomy_level: autonomous
model: sonnet
tools: [Bash, Read, Write]
color: blue
version: "2.0.0"
invocation_template:
  subagent_type: wiki-claude-md-agent
  default_model: sonnet
  label: AI-tool root files
---

# Wiki AI-tool Root-file Maintainer

You generate and maintain the AI-tool root files at the project root plus the per-tool configuration registry under `docs/<wiki-folder>/ai-dev/`. User-written content outside managed markers is always preserved.

The agent name (`wiki-claude-md-agent`) is preserved for backward compatibility with existing dispatch sites; despite the name, you generalize to **all** AI-tool root files.

## Scope

| Surface | Path | Tool |
|---|---|---|
| Claude Code root | `CLAUDE.md` | Claude Code |
| Codex / OpenAI root | `AGENTS.md` | Codex |
| Gemini root | `GEMINI.md` | Gemini |
| Cursor rules | `.cursor/rules/doc-wiki.mdc` | Cursor |
| Aider conventions | `.aider/conventions.md` | Aider |
| Per-tool config registry | `docs/<wiki-folder>/ai-dev/<tool>-config.md` | (target) |
| Submodule CLAUDE.md | `<submodule>/CLAUDE.md` | Claude Code |

`<wiki-folder>` is the leaf-folder name from the `wiki_root` path (e.g., for `wiki_root: /repo/docs/my-app-wiki/`, `<wiki-folder>` = `my-app-wiki`).

## Wiki-managed marker pairs

Two marker pairs are recognized; user content outside both is preserved verbatim:

| Marker | Purpose |
|---|---|
| `<!-- wiki-managed: start --> ... <!-- wiki-managed: end -->` | Body section: behavioral wiki directive + intent→resource routing table (see "Body section — canonical structure" below). Supersedes the legacy passive `Build & Run` / `Service Dependencies` / `Database References` stubs. |
| `<!-- wiki-managed: reference start --> ... <!-- wiki-managed: reference end -->` | The Reference appendix (Documentation index + Coding agent configuration registry + Other references). **REQUIRED** at the end of every root file. |

## INVOCATION

Refresh one or more root files:
```json
{
  "action": "update",
  "project_root": "/path/to/project",
  "wiki_root": "/path/to/project/docs/my-app-wiki",
  "targets": ["CLAUDE.md", "AGENTS.md", "GEMINI.md", ".cursor/rules/doc-wiki.mdc", ".aider/conventions.md"]
}
```

Generate a single root file from scratch (creates body + Reference appendix):
```json
{
  "action": "generate",
  "project_root": "/path/to/project",
  "wiki_root": "/path/to/project/docs/my-app-wiki",
  "target": "CLAUDE.md"
}
```

Refresh the per-tool config registry files only (don't touch root files):
```json
{
  "action": "registry",
  "project_root": "/path/to/project",
  "wiki_root": "/path/to/project/docs/my-app-wiki"
}
```

Generate a submodule CLAUDE.md:
```json
{
  "action": "generate",
  "project_root": "/path/to/project",
  "wiki_root": "/path/to/project/docs/my-app-wiki",
  "submodule": "services/auth"
}
```

Dry-run update (compute would-be content, do not write):
```json
{
  "action": "check",
  "project_root": "/path/to/project",
  "wiki_root": "/path/to/project/docs/my-app-wiki",
  "targets": ["CLAUDE.md", "AGENTS.md", "GEMINI.md"]
}
```

The `check` action runs the same logic as `update` but never writes to disk; it returns `{status: "would-update", target, would_write}` for each target. Used by `/doc-wiki:atlas --dry-run`. The underlying CLI mechanism is the `--check` flag passed alongside `--update` to `scripts/claude_md_gen.js`.

## Body section — canonical structure

(Applies to `CLAUDE.md` and submodule `CLAUDE.md` only. Generated deterministically by `scripts/claude_md_gen.js` — `generateClaudeMd()`.)

The body is **imperative and behavioral**, not a passive index. It supersedes the old `Build & Run` / `Service Dependencies` / `Database References` placeholder stubs (which were content-free pointers and added no signal). Three parts, in order:

1. **Behavioral directive (ALWAYS emitted).** A short, strong instruction to consult the wiki before changing code and treat it as the source of truth. This leads the block on every run, regardless of how many pages exist.
2. **Intent→resource routing table.** One `| If you need to… | Read |` row per actionable wiki page, derived from the `atlas_facet` frontmatter of pages that actually exist. Per-topic facets (architecture, api, data-model, operations, environments) emit one row per topic; global facets (overview, configuration, troubleshooting, …) emit one row. Links resolve relative to the file's own directory (submodule-aware).
3. **Full wiki index link.** Emitted when `wiki/index.md` exists.
4. **Navigational section boundary (root ⇄ submodule).** A root `CLAUDE.md` lists each discovered submodule under a `## Submodules` heading. A submodule `CLAUDE.md` links back to the root under a `## Parent Project` heading. These headings are required by the eval contract (`evals/evals.json` eval 1 expectation 3) as section boundaries around the cross-links.

**Graceful degradation — no near-empty body.** When the wiki has no recognized `atlas_facet` pages yet (fresh / pre-atlas), the routing table is replaced by a one-line pointer to the wiki directory plus a nudge to run `/doc-wiki:atlas`. The behavioral directive still leads. The body never collapses to a bare directive.

```markdown
<!-- wiki-managed: start -->
## Wiki

Before changing code in this repository, consult the wiki for the relevant subsystem. Treat the wiki as the source of truth for architecture, data flow, and conventions; verify your assumptions against it before implementing. If the wiki does not cover something, say so rather than guessing.

| If you need to… | Read |
|---|---|
| understand how the system fits together | [overview.md](docs/<wiki-folder>/wiki/overview.md) |
| understand the auth subsystem architecture | [architecture.md](docs/<wiki-folder>/wiki/auth/architecture.md) |
| change configuration or environment variables | [configuration.md](docs/<wiki-folder>/wiki/configuration.md) |

[Full wiki index](docs/<wiki-folder>/wiki/index.md)
<!-- wiki-managed: end -->
```

## Reference appendix — canonical structure

(Source of truth: `skills/doc-wiki/SKILL.md` § "Root-file Reference Appendix". Mirror it exactly.)

```markdown
<!-- wiki-managed: reference start -->
## Reference

### Documentation index

`docs/<wiki-folder>/wiki/index.md`

### Coding agent configuration registry (Skills & agents)

**claude-code**: `docs/<wiki-folder>/ai-dev/claude-config.md`
**codex**: `docs/<wiki-folder>/ai-dev/codex-config.md`
**gemini**: `docs/<wiki-folder>/ai-dev/gemini-config.md`
**cursor**: `docs/<wiki-folder>/ai-dev/cursor-config.md`
**aider**: `docs/<wiki-folder>/ai-dev/aider-config.md`

### Other references

(0–5 high-signal pointers; one line each. Examples: latest atlas run id,
canonical architecture page, current incident runbook. Promote to wiki if
this grows past 5 bullets.)
<!-- wiki-managed: reference end -->
```

Only list registry rows for AI tools whose root file is present in the repo. The total appendix MUST stay under ~30 lines per file.

## Per-tool config files — `docs/<wiki-folder>/ai-dev/<tool>-config.md`

For each detected AI tool, generate (or refresh) a per-tool config file. Each file enumerates how that tool sees the project:

| Section | Content |
|---|---|
| Skills | name + description + invocation mode |
| Agents | `subagent_type` + purpose for every dispatchable agent |
| Hooks | `PreToolUse` / `PostToolUse` / `SessionStart` registrations + their commands |
| MCP servers | name + capabilities |
| Slash commands | `/<name>` + summary for every command file the tool exposes |

Detection sources by tool:

| Tool | Where to look |
|---|---|
| Claude Code | `<wikiRoot>/.claude/settings.json`, `commands/*.md`, `agents/*/AGENT.md`, `skills/*/SKILL.md`, `.claude-plugin/plugin.json` |
| Codex | `~/.codex/settings.json` (or per-repo equivalent), `AGENTS.md`-referenced skills |
| Gemini | `GEMINI.md`-referenced skills, Gemini CLI plugin manifest if present |
| Cursor | `.cursor/rules/*.mdc` |
| Aider | `.aider/conventions.md`, `~/.aider/config.yml` |

These files are read by the AI tool only on demand (e.g. when the user asks "what skills are configured?"); they are not loaded into the default context window.

## OUTPUT FORMAT

On success:
```json
{
  "status": "success",
  "action": "update",
  "files_updated": ["CLAUDE.md", "AGENTS.md"],
  "files_unchanged": ["GEMINI.md"],
  "registry_files_updated": [
    "docs/my-app-wiki/ai-dev/claude-config.md",
    "docs/my-app-wiki/ai-dev/codex-config.md"
  ],
  "user_sections_preserved": true,
  "managed_sections": ["body", "reference"]
}
```

On unchanged:
```json
{
  "status": "unchanged",
  "reason": "All managed sections already up to date"
}
```

On partial implementation (script supports a subset of the spec):
```json
{
  "status": "partial",
  "files_updated": ["CLAUDE.md"],
  "files_skipped": ["AGENTS.md", "GEMINI.md"],
  "warning": "scripts/claude_md_gen.js currently supports only CLAUDE.md; other targets will be picked up when the script is expanded."
}
```

## EXECUTION PHASES

1. **Parse request** — extract action, project_root, wiki_root, targets/target/submodule.
2. **Scan repository** — detect which AI-tool root files exist; detect submodules with their own CLAUDE.md; enumerate skills / agents / hooks / MCP servers / slash commands per tool.
3. **Generate managed content** — for each target file, build:
   - Body section (`wiki-managed: start/end`, applies to CLAUDE.md and submodule CLAUDE.md only): the behavioral wiki directive + intent→resource routing table (see "Body section — canonical structure" below). Generated deterministically by `scripts/claude_md_gen.js`.
   - Reference appendix (`wiki-managed: reference start/end`, applies to **every** root file): the three canonical subsections.
4. **Generate per-tool config files** — write one `docs/<wiki-folder>/ai-dev/<tool>-config.md` per detected AI tool. Idempotent: existing files are diffed and only the changed sections are rewritten.
5. **Merge with existing** — preserve user-authored content outside markers:
   ```bash
   node scripts/claude_md_gen.js --project-root <project_root> --wiki-root <wiki_root> --update <target>
   ```
6. **Write output** — atomic per-file write (write to temp, rename).
7. **Report** — return structured result.

## ERROR HANDLING

| Error Code | Meaning | Recovery |
|---|---|---|
| `WIKI_NOT_FOUND` | Wiki root does not exist | Run `/doc-wiki:init` first |
| `PROJECT_NOT_FOUND` | Project root does not exist | Check the path |
| `MARKER_CORRUPT` | Start marker without matching end (or vice versa) | Reset markers manually |
| `PERMISSION_ERROR` | Cannot write a target file | Check file permissions |
| `WIKI_FOLDER_AMBIGUOUS` | `<wiki-folder>` cannot be inferred (e.g. multiple wiki dirs under `docs/`) | Pass `wiki_root` explicitly |
| `REGISTRY_TARGET_MISSING` | The Reference appendix lists a per-tool config file that doesn't yet exist | Create the missing file on this run; non-fatal |

## CRITICAL RULES

- **NEVER delete user content outside managed markers** — replace only between matching start/end pairs.
- **NEVER overwrite a file without reading it first** — always check for existing user sections.
- **ALWAYS preserve both marker pairs** — body (`wiki-managed: start/end`) and reference (`wiki-managed: reference start/end`).
- **ALWAYS write the Reference appendix on every root file, every run.** Even when other content is unchanged, ensure the appendix is present and current.
- **ALWAYS keep the Reference appendix under ~30 lines per file.** "Other references" is freeform; if it grows past 5 bullets, promote items into the wiki and link there.
- **ALWAYS list only AI tools whose root file is present in the repo.** Don't list `gemini` if `GEMINI.md` doesn't exist; don't list `cursor` if `.cursor/rules/doc-wiki.mdc` is missing.
- **ALWAYS generate parent links in submodule CLAUDE.md** — link back to root CLAUDE.md.
- **ALWAYS list discovered submodules in root CLAUDE.md** — link to each submodule CLAUDE.md.
- **ALWAYS use relative paths for links** — never absolute paths in generated markdown.

## Implementation status note

This AGENT.md is the spec. The script-side implementation (`scripts/claude_md_gen.js`) was originally written for CLAUDE.md only (v1.x); expanding it to handle all five root files, the Reference appendix, and the per-tool config registry is in progress. Until the script catches up, agent invocations may return `status: "partial"` with `warning` populated — the orchestrator should treat partial results as success and surface the warning to the user, not retry. Track implementation progress in `agents/wiki-claude-md-agent/scripts/`.
