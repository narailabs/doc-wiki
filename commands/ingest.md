---
description: Ingest a source — new source, or re-fetch with --refresh
argument-hint: '<source> [--wiki-root <path>] [--output <relative-path>] [--no-crosslink] [--no-tag-harmonize] | --refresh [--source <s> | --all]'
allowed-tools: Skill(doc-wiki)
---

Invoke the `doc-wiki` skill to run the `/doc-wiki:ingest` workflow with the user's arguments: $ARGUMENTS

Call `Skill(doc-wiki, "ingest $ARGUMENTS")`. The skill orchestrator reads `skills/doc-wiki/SKILL.md`, locates the `### /doc-wiki:ingest — Fetch + Extract + Compile` section, and dispatches one of two modes:

- **New-source mode** (default, when a positional source is given): runs the 13-step ingest pipeline (parse config, check cache, extract binary if needed, security-check URLs, read source fully, surface takeaways, cross-reference active agents, compile pages, auto-generate Mermaid, generate "How to Go Deeper", update indexes + summaries, log event, run post-op hooks).
- **Refresh mode** (when `--refresh` is present): re-fetches previously-ingested sources, diffs against stored versions, re-compiles changed pages. The set of previously-ingested sources is reconstructed from `op: ingest` entries in `<wikiRoot>/log/events.jsonl`. `--source <s>` scopes to one matching source (by URL, label, or path); `--all` scopes to every prior ingest. Supports checkpoint resume for interrupted batch refreshes.

The two modes are mutually exclusive — passing both a positional source and `--refresh` is an error.

If `$ARGUMENTS` is empty, ask the user for the source (file path, URL, folder, or pasted text) or confirm a default refresh.
