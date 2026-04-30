# quality-score — recomputed post-fix

Command:

```
node skills/wiki/scripts/quality_score.js --page wiki/authentication.md
```

Output:

```json
{
  "quality": 0.4,
  "signals": [
    {"signal": "word_count",           "delta": 0.3},
    {"signal": "complete_frontmatter", "delta": 0.1}
  ]
}
```

## Interpretation

The scorer emits a base score derived from signals fired, not the
frontmatter's declared `quality: 0.85`. After the fix:

- `word_count` fires (delta 0.3): page has enough body text (two paragraphs
  + headings).
- `complete_frontmatter` fires (delta 0.1): required keys present
  (`title`, `type`, `tags`, `sources`, `created`, `updated`, `summary`).

Signals that did not fire in this three-page isolated workspace — `has_links`,
`edges_present`, etc. — are not attributable to the fix; they reflect the
absence of an edges graph in this minimal eval.

## Wired into the fix event

The recomputed value `0.4` is recorded in `log/events.jsonl` as
`quality_score: 0.4`. The previous declared score is captured as
`prev_quality: 0.85` in the same event, so the audit entry carries both the
before and after quality signals. See `events.jsonl` in this output bundle.
