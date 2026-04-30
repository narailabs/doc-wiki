---
description: Promote query answer
argument-hint: '<file> | last | latest | <N> | --review [--since <dur>] [--limit <N>] [--topic <directory>]'
allowed-tools: Skill(doc-wiki)
---

Invoke the `doc-wiki` skill to run the `/doc-wiki:promote` workflow with the user's arguments: $ARGUMENTS

Call `Skill(doc-wiki, "promote $ARGUMENTS")`. The skill orchestrator reads `skills/doc-wiki/SKILL.md`, locates the `### /doc-wiki:promote — Query answer -> wiki page` section, and dispatches to:

- **Single mode** (default) — resolve the target (`last`/`latest`/`last query`/`latest query` → most recent in `outputs/queries/`; integer `N` → Nth most recent; path → as-is; single token → filename substring match; empty → list-and-pick), then convert that archived answer into a wiki page (frontmatter, citation→link rewriting, topic placement) and move the archive to `outputs/queries/.promoted/`.
- **Review mode** (`--review`) — bulk archive triage with per-item approval (P/S/D/A), honoring autonomy mode. Supports `--since <duration>` and `--limit <N>` for filtering.
