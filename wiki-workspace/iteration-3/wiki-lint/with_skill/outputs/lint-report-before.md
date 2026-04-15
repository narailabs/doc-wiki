# /wiki-lint — pre-fix report

Raw output of `node .claude/skills/wiki/scripts/lint_checks.js --wiki-root /tmp/eval-i3-lint-wiki` before any auto-fix.

Summary: **5 errors, 6 warnings, 0 info** — the 5 errors split into 2 `broken_links` and 3 `missing_frontmatter` violations that the skill must heal. Every violation record names the offending file path.

## Raw JSON

```json
{
  "issues": [
    {
      "severity": "error",
      "category": "broken_links",
      "page": "/tmp/eval-i3-lint-wiki/wiki/page-a.md",
      "detail": "Link to ./page-d.md not found"
    },
    {
      "severity": "error",
      "category": "broken_links",
      "page": "/tmp/eval-i3-lint-wiki/wiki/page-c.md",
      "detail": "Link to ./ghost.md not found"
    },
    {
      "severity": "error",
      "category": "missing_frontmatter",
      "page": "/tmp/eval-i3-lint-wiki/wiki/page-b.md",
      "detail": "Missing required frontmatter field: sources"
    },
    {
      "severity": "error",
      "category": "missing_frontmatter",
      "page": "/tmp/eval-i3-lint-wiki/wiki/page-b.md",
      "detail": "Missing required frontmatter field: tags"
    },
    {
      "severity": "error",
      "category": "missing_frontmatter",
      "page": "/tmp/eval-i3-lint-wiki/wiki/page-c.md",
      "detail": "No frontmatter found (missing --- delimiters)"
    },
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
      "page": "wiki/page-e.md",
      "detail": "Node has degree <= 1 in the knowledge graph"
    }
  ],
  "summary": {
    "error": 5,
    "warning": 6,
    "info": 0
  }
}
```

## Assertion-relevant subset

| Category | File | Detail |
|---|---|---|
| broken_links | /tmp/eval-i3-lint-wiki/wiki/page-a.md | Link to ./page-d.md not found |
| broken_links | /tmp/eval-i3-lint-wiki/wiki/page-c.md | Link to ./ghost.md not found |
| missing_frontmatter | /tmp/eval-i3-lint-wiki/wiki/page-b.md | Missing required frontmatter field: sources |
| missing_frontmatter | /tmp/eval-i3-lint-wiki/wiki/page-b.md | Missing required frontmatter field: tags |
| missing_frontmatter | /tmp/eval-i3-lint-wiki/wiki/page-c.md | No frontmatter found (missing --- delimiters) |

Both mandatory categories are represented and every record carries the offending file path.
