# /wiki-lint — post-fix report

Raw output of `node .claude/skills/wiki/scripts/lint_checks.js --wiki-root /tmp/eval-i3-lint-wiki` after `/wiki-fix` applied the auto-heal actions.

Summary: **0 errors, 7 warnings, 0 info** — zero `broken_links` and zero `missing_frontmatter` violations remain. The remaining warnings are `orphan_page` / `isolated_node` signals that fall outside the scope of this eval's lint targets (graph connectivity rather than structural lint).

## Raw JSON

```json
{
  "issues": [
    {
      "severity": "warning",
      "category": "orphan_page",
      "page": "/tmp/eval-i3-lint-wiki/wiki/page-c.md",
      "detail": "Page is not linked from any other page"
    },
    {
      "severity": "warning",
      "category": "orphan_page",
      "page": "/tmp/eval-i3-lint-wiki/wiki/page-e.md",
      "detail": "Page is not linked from any other page"
    },
    {
      "severity": "warning",
      "category": "isolated_node",
      "page": "wiki/page-a.md",
      "detail": "Node has degree <= 1 in the knowledge graph"
    },
    {
      "severity": "warning",
      "category": "isolated_node",
      "page": "wiki/page-b.md",
      "detail": "Node has degree <= 1 in the knowledge graph"
    },
    {
      "severity": "warning",
      "category": "isolated_node",
      "page": "wiki/page-c.md",
      "detail": "Node has degree <= 1 in the knowledge graph"
    },
    {
      "severity": "warning",
      "category": "isolated_node",
      "page": "wiki/page-d.md",
      "detail": "Node has degree <= 1 in the knowledge graph"
    },
    {
      "severity": "warning",
      "category": "isolated_node",
      "page": "wiki/page-e.md",
      "detail": "Node has degree <= 1 in the knowledge graph"
    }
  ],
  "summary": {
    "error": 0,
    "warning": 7,
    "info": 0
  }
}
```

## Category counts (assertion-relevant)

| Category | Count after fix |
|---|---|
| broken_links | 0 |
| missing_frontmatter | 0 |

Both assertion-target categories are fully healed.
