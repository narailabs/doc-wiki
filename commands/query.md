---
description: Search + synthesize wiki (or shortest-path between concepts in path mode)
argument-hint: '<question> | --from <a> --to <b> [--max-hops <N>] [--via <c>] [--all-paths] [--wiki-root <path>] [--max-depth <N>]'
allowed-tools: Skill(doc-wiki)
---

Invoke the `doc-wiki` skill to run the `/doc-wiki:query` workflow with the user's arguments: $ARGUMENTS

Call `Skill(doc-wiki, "query $ARGUMENTS")`. The skill orchestrator reads `skills/doc-wiki/SKILL.md`, locates the `### /doc-wiki:query — Summary-first search + synthesis` section, and dispatches one of two modes:

- **Synthesis mode** (default): runs the summary-first flow — read `summaries.md`, score relevance, load top-N pages, follow links up to 5 levels, synthesize with citations, surface contradictions, archive to `outputs/queries/`, log token efficiency.
- **Path mode** (when `--from` and `--to` are present): shells out to `graph_ops.js path` against `<wiki-root>/graph/edges.jsonl` and returns the typed-edge chain connecting the two concepts. Skips summary-first scoring, link-following, and synthesis.

If `$ARGUMENTS` is empty, ask the user for the question they want to answer from the wiki (or for the two concepts to connect via path mode).
