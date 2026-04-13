---
description: Summary-first search and synthesis across the wiki
argument-hint: '<question> [--wiki-root <path>] [--max-depth <N>]'
allowed-tools: Skill(wiki)
---

Invoke the `wiki` skill to run the `/wiki-query` workflow with the user's arguments: $ARGUMENTS

Call `Skill(wiki, "query $ARGUMENTS")`. The skill orchestrator reads `.claude/skills/wiki/SKILL.md`, locates the `### /wiki-query — Summary-first search + synthesis` section, and runs the summary-first synthesis flow (read `summaries.md`, score relevance, load top-N pages, follow links up to 5 levels, synthesize with citations, surface contradictions, archive to `outputs/queries/`, log token efficiency).

If `$ARGUMENTS` is empty, ask the user for the question they want to answer from the wiki.
