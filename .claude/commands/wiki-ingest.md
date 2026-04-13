---
description: Ingest a source (file, URL, folder, or pasted text) into the wiki
argument-hint: '<source> [--wiki-root <path>] [--no-crosslink] [--no-tag-harmonize]'
allowed-tools: Skill(wiki)
---

Invoke the `wiki` skill to run the `/wiki-ingest` workflow with the user's arguments: $ARGUMENTS

Call `Skill(wiki, "ingest $ARGUMENTS")`. The skill orchestrator reads `.claude/skills/wiki/SKILL.md`, locates the `### /wiki-ingest — Fetch + Extract + Compile` section, and runs the 13-step ingest pipeline (parse config, check cache, extract binary if needed, security-check URLs, read source fully, surface takeaways, cross-reference active agents, compile pages, auto-generate Mermaid, generate "How to Go Deeper", update indexes + summaries, log event, run post-op hooks).

If `$ARGUMENTS` is empty, ask the user for the source (file path, URL, folder, or pasted text).
