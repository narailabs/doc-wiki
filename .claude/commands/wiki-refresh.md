---
description: Re-fetch and update previously-ingested sources
argument-hint: '[--source <source>] [--all] [--wiki-root <path>]'
allowed-tools: Skill(wiki)
---

Invoke the `wiki` skill to run the `/wiki-refresh` workflow with the user's arguments: $ARGUMENTS

Call `Skill(wiki, "refresh $ARGUMENTS")`. The skill orchestrator reads `.claude/skills/wiki/SKILL.md`, locates the `### /wiki-refresh — Re-fetch and update from original sources` section, and re-fetches previously-ingested sources, diffs against stored versions, and re-compiles changed pages. Supports checkpoint resume for interrupted batch refreshes.

If `$ARGUMENTS` is empty, default to `--all` and ask the user to confirm before starting a full refresh.
