# Stats result

```json
{
  "total_ops": 17,
  "ops_by_type": { "ingest": 7, "query": 6, "lint": 2, "fix": 2 },
  "total_tokens_by_op": { "ingest": 7700, "query": 5350, "fix": 700 },
  "avg_duration_ms_by_op": { "ingest": 307.14, "query": 195.83, "lint": 87.5, "fix": 142.5 }
}
```

## Per-op breakdown (7-day window)

| op | count | total_tokens | avg_duration_ms |
|---|---|---|---|
| ingest | 7 | 7700 | 307.14 |
| query | 6 | 5350 | 195.83 |
| lint | 2 | (absent — all zero) | 87.5 |
| fix | 2 | 700 | 142.5 |

Note: `lint` doesn't appear in `total_tokens_by_op` because all its events had `tokens: 0`. The aggregator filters out zero-token contributors so the field surfaces only meaningful totals.
