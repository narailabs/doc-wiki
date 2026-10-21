# Shortest-path proof — authentication → database-schema

## All simple directed paths in the fixture

Enumerated with `graph_ops.allPaths('/tmp/eval-i3-path-wiki/graph/edges.jsonl', 'authentication', 'database-schema', 20)`. Exactly two simple paths exist.

### Path A (3 hops — shortest, selected)

| # | from              | to                | type     | provenance |
|---|-------------------|-------------------|----------|------------|
| 1 | authentication    | user-model        | supports | INFERRED   |
| 2 | user-model        | orm-mapping       | supports | EXTRACTED  |
| 3 | orm-mapping       | database-schema   | supports | EXTRACTED  |

Chain: `authentication → user-model → orm-mapping → database-schema`
Length: 3 edges.

### Path B (4 hops — alternative)

| # | from               | to                 | type     | provenance |
|---|--------------------|--------------------|----------|------------|
| 1 | authentication     | session-management | supports | EXTRACTED  |
| 2 | session-management | user-model         | extends  | INFERRED   |
| 3 | user-model         | orm-mapping        | supports | EXTRACTED  |
| 4 | orm-mapping        | database-schema    | supports | EXTRACTED  |

Chain: `authentication → session-management → user-model → orm-mapping → database-schema`
Length: 4 edges.

## Why 3 hops is minimal

- There is **no 1-hop** edge `(authentication → database-schema)` in the fixture.
- There is **no 2-hop** chain: the only outgoing edges from `authentication` are to `session-management` and `user-model`, and neither of those has a direct edge to `database-schema`.
  - `session-management` → only outgoing edge is to `user-model`.
  - `user-model` → only outgoing edge is to `orm-mapping`.
- 3-hop is the first achievable length, and Path A realizes it.

Thus 3 hops is provably the minimum. The BFS returned Path A; Path B (4 hops) is strictly longer.

## Node-level reachability summary

Outgoing adjacency in `edges.jsonl`:

| node               | out-edges                                   |
|--------------------|---------------------------------------------|
| authentication     | → session-management, → user-model          |
| session-management | → user-model                                |
| user-model         | → orm-mapping                               |
| orm-mapping        | → database-schema                           |
| database-schema    | (sink, no outgoing edges)                   |

This DAG-like shape means `database-schema` is reachable from `authentication` but not vice-versa — used to motivate the no-path test in `no-path-test.md`.
