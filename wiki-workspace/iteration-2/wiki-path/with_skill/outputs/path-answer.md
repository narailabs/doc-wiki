---
title: "Shortest path: authentication -> database-schema"
type: query-answer
tags: [path, authentication, database-schema]
created: 2026-04-14
---

# Shortest path: `authentication` -> `database-schema`

Invoked `/wiki-path` against `/tmp/eval-path-wiki/graph/edges.jsonl`.

## Result

Length: **3 hops** (4 nodes).

| # | From | Edge type | Provenance | To |
|---|---|---|---|---|
| 1 | [authentication](../../../../../../../tmp/eval-path-wiki/wiki/authentication.md) | `supports` | INFERRED | [user-model](../../../../../../../tmp/eval-path-wiki/wiki/user-model.md) |
| 2 | [user-model](../../../../../../../tmp/eval-path-wiki/wiki/user-model.md) | `supports` | EXTRACTED | [orm-mapping](../../../../../../../tmp/eval-path-wiki/wiki/orm-mapping.md) |
| 3 | [orm-mapping](../../../../../../../tmp/eval-path-wiki/wiki/orm-mapping.md) | `supports` | EXTRACTED | [database-schema](../../../../../../../tmp/eval-path-wiki/wiki/database-schema.md) |

## Intermediate pages

1. **user-model** — the shortcut that skips `session-management`
2. **orm-mapping** — bridge from domain entity to physical schema

## Alternative longer path (4 hops, not chosen)

`authentication -> session-management -> user-model -> orm-mapping -> database-schema`

The tool correctly preferred the 3-hop route because `bidirectional` unweighted BFS minimizes edge count. Note that one edge of the chosen path (`authentication -> user-model`) carries `INFERRED` provenance rather than `EXTRACTED`; the path algorithm is provenance-blind and picks the shortest chain regardless.

## Command

```bash
node .claude/skills/wiki/scripts/graph_ops.js path \
  --edges /tmp/eval-path-wiki/graph/edges.jsonl \
  --from "authentication" \
  --to "database-schema"
```

## Raw JSON

See `graph_ops-raw-output.txt`.
