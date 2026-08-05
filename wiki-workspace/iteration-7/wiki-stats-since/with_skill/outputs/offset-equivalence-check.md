# UTC offset equivalence check: Z vs +00:00

## Invocations compared

```
# Z variant
node event_logger.js stats --wiki-root /tmp/eval-i7-stats-since-wiki --since 2026-04-01T00:00:00Z

# +00:00 variant
node event_logger.js stats --wiki-root /tmp/eval-i7-stats-since-wiki --since 2026-04-01T00:00:00+00:00
```

## Output diff

```diff
--- stats-iso.json (Z variant)
+++ stats-utc-offset.json (+00:00 variant)
```

No differences. Both files are byte-identical.

## stats-iso.json content
```json
{
  "total_ops": 5,
  "ops_by_type": {
    "ingest": 2,
    "query": 2,
    "lint": 1
  },
  "total_cost_usd": 0.0,
  "reduction_ratio": {},
  "per_agent_cost": {},
  "total_tokens_by_op": {
    "ingest": 1020,
    "query": 1040,
    "lint": 480
  },
  "avg_duration_ms_by_op": {
    "ingest": 155,
    "query": 160,
    "lint": 140
  }
}
```

## stats-utc-offset.json content
```json
{
  "total_ops": 5,
  "ops_by_type": {
    "ingest": 2,
    "query": 2,
    "lint": 1
  },
  "total_cost_usd": 0.0,
  "reduction_ratio": {},
  "per_agent_cost": {},
  "total_tokens_by_op": {
    "ingest": 1020,
    "query": 1040,
    "lint": 480
  },
  "avg_duration_ms_by_op": {
    "ingest": 155,
    "query": 160,
    "lint": 140
  }
}
```

## Assertion 7 verdict

Both `2026-04-01T00:00:00Z` and `2026-04-01T00:00:00+00:00` produce identical JSON output with the same total_ops=5. The `parsePythonIsoformat()` function correctly handles both formats via JavaScript's native `Date.parse()`, which treats both as equivalent UTC timestamps.

Assertion 7 PASSES.
