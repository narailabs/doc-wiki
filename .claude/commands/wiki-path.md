---
description: Shortest-path query between two concepts via typed edges
argument-hint: '--from <concept-a> --to <concept-b> [--max-hops <N>] [--via <concept>] [--all-paths]'
allowed-tools: Skill(wiki)
---

Invoke the `wiki` skill to run the `/wiki-path` workflow with the user's arguments: $ARGUMENTS

Call `Skill(wiki, "path $ARGUMENTS")`. The skill orchestrator reads `.claude/skills/wiki/SKILL.md`, locates the `### /wiki-path — Shortest-path query between concepts` section, and runs `graph_ops.ts path` against `graph/edges.jsonl` to return the typed-edge chain connecting two concepts (supports `--max-hops`, `--via`, `--all-paths`).

If `$ARGUMENTS` is empty or missing `--from`/`--to`, ask the user for the two concepts to connect.
