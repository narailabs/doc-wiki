# S3 native-field check — PASS

Both fields are emitted **natively** by `event_logger.js stats` — no post-processing required.

## Before (iteration-4)

`getStats` returned only `total_ops`, `ops_by_type`, `total_cost_usd`, `reduction_ratio`, `per_agent_cost`. The eval had to manually compute tokens and durations from the fixture — a vacuous pass.

## After (iteration-5)

`getStats` also returns:

- `total_tokens_by_op` — sums `event.tokens` / `event.total_tokens` / `event.tokens_in + event.tokens_out` per op. Zero-token ops are omitted (keeps the field compact and meaningful).
- `avg_duration_ms_by_op` — averages `event.duration_ms` / `event.total_duration_ms` / `event.total_duration_seconds × 1000` per op; rounded to 2dp.

jq proof:

```
jq '.total_tokens_by_op' stdout.txt
→ {"ingest": 7700, "query": 5350, "fix": 700}

jq '.avg_duration_ms_by_op' stdout.txt
→ {"ingest": 307.14, "query": 195.83, "lint": 87.5, "fix": 142.5}
```
