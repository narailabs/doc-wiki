# /wiki-path — no-path tests

The `/wiki-path` script returns an empty JSON array (`[]`) whenever no directed path exists. The wiki skill then surfaces this to the user as a human-readable explanation rather than a stack trace or a bare `[]`.

## Case 1 — Reverse direction (unreachable)

**Command**

```bash
node .claude/skills/wiki/scripts/graph_ops.js path \
  --edges /tmp/eval-i3-path-wiki/graph/edges.jsonl \
  --from database-schema \
  --to authentication
```

**Raw output:** `[]`

**Human-readable answer**

> No path found from `database-schema` to `authentication`.
>
> All five edges in the fixture flow in the forward direction
> (authentication → ... → database-schema). Since `database-schema`
> has no outgoing edges in `edges.jsonl`, it is a sink — nothing is
> reachable from it. The typed-edge graph is directed, so reverse
> traversal is not attempted.
>
> **Suggestions:**
> - If you intended a symmetric relationship, add an explicit
>   reverse edge (e.g. `{"from":"database-schema","to":"orm-mapping", "type":"extends", "provenance":"INFERRED"}`) or rethink the edge type.
> - If you meant the forward direction, re-run with `--from authentication --to database-schema`.

## Case 2 — Unknown target concept

**Command**

```bash
node .claude/skills/wiki/scripts/graph_ops.js path \
  --edges /tmp/eval-i3-path-wiki/graph/edges.jsonl \
  --from authentication \
  --to nonexistent-concept
```

**Raw output:** `[]`

**Human-readable answer**

> No path found from `authentication` to `nonexistent-concept`.
>
> The concept `nonexistent-concept` does not appear as either the
> source or target of any edge in `graph/edges.jsonl`. It may be a
> typo, or the concept may not yet have been ingested into the wiki.
>
> Known concepts in this fixture:
> `authentication`, `session-management`, `user-model`,
> `orm-mapping`, `database-schema`.
>
> **Suggestions:**
> - Check spelling against `wiki/index.md`.
> - Run `/wiki-ingest` to add the concept if it represents real content.
> - Run `/wiki-stats` to see the full list of nodes currently in the graph.

## Failure-mode notes

- Neither invocation threw an exception or printed a stack trace; both exited 0 with an empty JSON array on stdout. This is the contract `/wiki-path` relies on to distinguish "no path" from "runtime error".
- Empty result is distinguishable from a successful result because a found path always contains at least one edge dict with a non-empty `type` and `provenance`.
