# Invalid granularity check: --since 1z

## Invocation
```
node event_logger.js stats --wiki-root /tmp/eval-i7-stats-since-wiki --since 1z
```

## Observed behavior

- **Exit code:** 0 (success — no error thrown)
- **stderr:** empty (no output)
- **stdout:** full JSON with total_ops=12 (all events — no filter applied)

## What happened in the code

`parseRelativeSince("1z")` is called first. The regex `/^(\d+)([dhm])$/` does NOT match "1z" because "z" is not in `[dhm]`. The function returns the input string unchanged: `"1z"`.

Then `parsePythonIsoformat("1z")` is called. `Date.parse("1z")` returns `NaN`.

In `_readEvents()`, the check is:
```typescript
if (sinceMs !== null && !Number.isNaN(sinceMs)) {
  // filter applied
}
```

Since `sinceMs` is `NaN`, the condition `!Number.isNaN(sinceMs)` is `false`, so the filter is SKIPPED entirely.

## Assertion 6 verdict

The assertion states: "the script either errors with a non-zero exit and a human-readable message OR returns total_events=0 with an explicit warning — silent fallback to 'no filter' is a failure"

The actual behavior is a SILENT FALLBACK to no filter (total_ops=12, exit code 0, no stderr). This is exactly what assertion 6 identifies as a failure condition.

The script does NOT error (exit 0), does NOT return total_events=0, and produces NO warning. It silently treats the invalid `--since 1z` as if no filter was provided.
