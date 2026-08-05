# /wiki-path — authentication → database-schema

**Command executed**

```bash
node skills/wiki/scripts/graph_ops.js path \
  --edges /tmp/eval-i3-path-wiki/graph/edges.jsonl \
  --from authentication \
  --to database-schema
```

**Result: 3-hop shortest path**

| Hop | From                | → | To                | Edge type  | Provenance |
|-----|---------------------|---|-------------------|------------|------------|
| 1   | `authentication`    | → | `user-model`      | supports   | INFERRED   |
| 2   | `user-model`        | → | `orm-mapping`     | supports   | EXTRACTED  |
| 3   | `orm-mapping`       | → | `database-schema` | supports   | EXTRACTED  |

**Path chain:** `authentication → user-model → orm-mapping → database-schema`

## Intermediate nodes

- `user-model` — appears as the target of edge #1 and the source of edge #2 in `edges.jsonl`
- `orm-mapping` — appears as the target of edge #2 and the source of edge #3 in `edges.jsonl`

## Edge validation (no hallucinated links)

Each consecutive `(from, to)` pair in the returned path was checked against the raw edges file:

| (from, to)                           | Present in edges.jsonl? |
|--------------------------------------|-------------------------|
| (authentication, user-model)         | yes (line 5)            |
| (user-model, orm-mapping)            | yes (line 3)            |
| (orm-mapping, database-schema)       | yes (line 4)            |

## Shortest-path proof

The fixture contains only two simple directed paths from `authentication` to `database-schema` (enumerated via `graph_ops.allPaths`, see `shortest-proof.md`):

1. **3 hops:** `authentication → user-model → orm-mapping → database-schema` ← selected
2. **4 hops:** `authentication → session-management → user-model → orm-mapping → database-schema`

No 1-hop or 2-hop chain exists (authentication has no direct edge to `orm-mapping` or `database-schema`), so 3 hops is provably minimal. `graph_ops.js` uses graphology's `bidirectional` BFS on the directed graph, which is guaranteed to return the shortest unweighted path.
