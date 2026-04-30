---
description: Shortest path between concepts
argument-hint: '--from <concept-a> --to <concept-b> [--max-hops <N>] [--via <concept>] [--all-paths]'
allowed-tools: Skill(doc-wiki)
---

Invoke the `doc-wiki` skill to run the `/doc-wiki:path` workflow with the user's arguments: $ARGUMENTS

Call `Skill(doc-wiki, "path $ARGUMENTS")`. The skill orchestrator reads `skills/doc-wiki/SKILL.md`, locates the `### /doc-wiki:path — Shortest-path query between concepts` section, and runs `graph_ops.ts path` against `graph/edges.jsonl` to return the typed-edge chain connecting two concepts (supports `--max-hops`, `--via`, `--all-paths`).

If `$ARGUMENTS` is empty or missing `--from`/`--to`, ask the user for the two concepts to connect.
