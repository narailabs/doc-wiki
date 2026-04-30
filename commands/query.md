---
description: Search + synthesize wiki
argument-hint: '<question> [--wiki-root <path>] [--max-depth <N>]'
allowed-tools: Skill(doc-wiki)
---

Invoke the `doc-wiki` skill to run the `/doc-wiki:query` workflow with the user's arguments: $ARGUMENTS

Call `Skill(doc-wiki, "query $ARGUMENTS")`. The skill orchestrator reads `skills/doc-wiki/SKILL.md`, locates the `### /doc-wiki:query — Summary-first search + synthesis` section, and runs the summary-first synthesis flow (read `summaries.md`, score relevance, load top-N pages, follow links up to 5 levels, synthesize with citations, surface contradictions, archive to `outputs/queries/`, log token efficiency).

If `$ARGUMENTS` is empty, ask the user for the question they want to answer from the wiki.
