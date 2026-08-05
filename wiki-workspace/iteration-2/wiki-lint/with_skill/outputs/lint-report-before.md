# Lint Report — BEFORE fixes

Wiki root: `/tmp/eval-lint-wiki/`
Command: `node skills/wiki/scripts/lint_checks.js --wiki-root /tmp/eval-lint-wiki/`

## Summary

| Severity | Count |
|---|---|
| error | 8 |
| warning | 6 |
| info | 0 |
| **Total** | **14** |

## Errors (8)

### broken_links (2)
- `wiki/page-a.md` — Link to `./page-d.md` not found
- `wiki/page-c.md` — Link to `./ghost.md` not found

### missing_frontmatter (6)
- `wiki/page-a.md` — Missing required frontmatter field: `quality`
- `wiki/page-b.md` — Missing required frontmatter field: `quality`
- `wiki/page-b.md` — Missing required frontmatter field: `sources`
- `wiki/page-b.md` — Missing required frontmatter field: `tags`
- `wiki/page-c.md` — No frontmatter found (missing `---` delimiters)
- `wiki/page-e.md` — Missing required frontmatter field: `quality`

## Warnings (6)

### orphan_page (2)
- `wiki/page-c.md` — Page is not linked from any other page
- `wiki/page-e.md` — Page is not linked from any other page

### isolated_node (4)
- `wiki/page-a.md` — Node has degree <= 1 in the knowledge graph
- `wiki/page-b.md` — Node has degree <= 1 in the knowledge graph
- `wiki/page-c.md` — Node has degree <= 1 in the knowledge graph
- `wiki/page-e.md` — Node has degree <= 1 in the knowledge graph
