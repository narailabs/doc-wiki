---
description: Ingest a source
argument-hint: '<source> [--wiki-root <path>] [--no-crosslink] [--no-tag-harmonize]'
allowed-tools: Skill(doc-wiki)
---

Invoke the `doc-wiki` skill to run the `/doc-wiki:ingest` workflow with the user's arguments: $ARGUMENTS

Call `Skill(doc-wiki, "ingest $ARGUMENTS")`. The skill orchestrator reads `skills/doc-wiki/SKILL.md`, locates the `### /doc-wiki:ingest — Fetch + Extract + Compile` section, and runs the 13-step ingest pipeline (parse config, check cache, extract binary if needed, security-check URLs, read source fully, surface takeaways, cross-reference active agents, compile pages, auto-generate Mermaid, generate "How to Go Deeper", update indexes + summaries, log event, run post-op hooks).

If `$ARGUMENTS` is empty, ask the user for the source (file path, URL, folder, or pasted text).
