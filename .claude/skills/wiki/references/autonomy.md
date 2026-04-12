# Autonomy System — 4 Modes

## Modes

| Mode | Structural Fixes | Content Suggestions | Disputes/Contradictions | Use When |
|---|---|---|---|---|
| `conservative` | Ask before applying | Ask before applying | Always to audit inbox | First-time setup, sensitive content |
| `balanced` | Auto-apply | Show diff, ask user | To audit inbox | Normal interactive use (DEFAULT) |
| `autonomous` | Auto-apply | Auto-apply | To audit inbox | Trusted, ongoing maintenance |
| `auto` | Auto-apply | Skip (no user present) | To audit inbox | Unattended pipeline runs |

## Per-Category Overrides

Override the mode's default for specific issue types:

```yaml
autonomy:
  mode: balanced
  overrides:
    broken_links: auto_fix          # always auto-fix
    missing_frontmatter: auto_fix
    contradictions: human_review    # always ask
    stale_content: suggest          # show diff, ask
```

Override values: `auto_fix`, `suggest`, `human_review`

## Decision Flow

When an issue is detected during lint or ingest:

1. **Check category override.** If an override exists for this issue type, use the override action.
2. **Otherwise, check autonomy mode:**
   - `conservative` → ask user for every change
   - `balanced` → auto-fix structural issues, ask for content changes, file disputes to audit
   - `autonomous` → auto-fix everything except disputes (disputes always go to audit)
   - `auto` → auto-fix structural, skip content suggestions (no user present), queue disputes

3. **Log the action** to events.jsonl regardless of outcome.

## Issue Types

**Structural** (deterministic, auto-fixable):
- broken_links, missing_frontmatter, orphan_pages, index_coverage, summaries_sync

**Content** (requires judgment):
- contradictions, stale_content, terminology_consistency, missing_coverage, under_linked_concepts

**Disputes** (always to audit inbox):
- Factual contradictions between pages
- Conflicting claims with evidence on both sides

## Audit Inbox

Disputes and human-review items go to `audit/open/`. Each file:

```yaml
---
target: wiki/ml/transformers.md
severity: warn
category: contradiction
status: open
detected_by: lint
---
Description of the issue.
```

Resolved items move to `audit/resolved/`.
