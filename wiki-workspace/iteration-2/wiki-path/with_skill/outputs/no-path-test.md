---
title: "No-path behaviour: impossible target"
type: query-answer
tags: [path, error-handling]
created: 2026-04-14
---

# No-path behaviour

Two negative-case invocations verified `graph_ops path` handles "unreachable target" cleanly.

## Case A — unknown node

```bash
node graph_ops.js path --edges /tmp/eval-path-wiki/graph/edges.jsonl \
  --from "authentication" --to "nonexistent-concept"
```

**stdout:**
```
[]
```

**exit code:** `0`

No crash, no stderr. The script returns an empty JSON array when either endpoint is missing from the graph (see `shortestPath` in `graph_ops.ts` — the `!graph.hasNode(...)` guard returns `[]`).

## Case B — node present but unreachable (reverse direction)

The edges are directed. Walking `database-schema -> authentication` has no route:

```bash
node graph_ops.js path --edges /tmp/eval-path-wiki/graph/edges.jsonl \
  --from "database-schema" --to "authentication"
```

**stdout:**
```
[]
```

**exit code:** `0`

Graceful: empty array. `bidirectional()` returns `null`, which `bidiPath` normalises to `null`, which `shortestPath` turns into `[]`.

## Interpretation guidance for callers

- `[]` means "no directed path within `maxHops` (default 6)".
- To distinguish "node unknown" from "node known but disconnected", run `graph_ops.js degrees` and look up the node there.
- The `--max-hops` cap also returns `[]` when exceeded; the spec in `operations.md` documents `{"status":"no_path","max_hops":N}` as an alternative shape, but the current TS implementation uniformly returns `[]` for all no-path cases.
