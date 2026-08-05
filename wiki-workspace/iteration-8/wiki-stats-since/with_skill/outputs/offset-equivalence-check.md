# Offset Equivalence Check — Assertion 7

Verifies that `--since 2026-04-01T00:00:00Z` and
`--since 2026-04-01T00:00:00+00:00` produce byte-identical output.

## Diff

```
diff stats-iso.json stats-utc-offset.json
(no differences)
```

## Side-by-side comparison

Both files contain:

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
    "ingest": 1000,
    "query": 1000,
    "lint": 500
  },
  "avg_duration_ms_by_op": {
    "ingest": 150,
    "query": 150,
    "lint": 150
  }
}
```

## Why they are equivalent

`parseRelativeSince("2026-04-01T00:00:00+00:00")` passes through unchanged
(no relative-duration match). Then `parsePythonIsoformat()` calls
`Date.parse()` on both forms — JavaScript's `Date.parse()` treats `Z` and
`+00:00` as equivalent UTC representations, returning the same epoch
milliseconds for both. The filter threshold is therefore identical.

## Conclusion

Z-suffix and +00:00-offset ISO timestamps are treated identically.
Assertion 7: **PASS**
