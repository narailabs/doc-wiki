# Assertions Evidence

Evidence for each of the 7 assertions in eval_metadata.json (eval_id=12, wiki-stats-since).

## Assertion 1: --since 1h returns total_events=2

**Evidence file:** stats-1h.json

`total_ops` = **2**. The fixture has 2 events with timestamps at 2026-04-15T00:31:16Z and 2026-04-15T00:31:22Z, both approximately 30 minutes before the run time (2026-04-15T01:01:xx). The `--since 1h` filter computed `parseRelativeSince("1h")` → a timestamp 1 hour before now, which excludes all other cohorts. Both 30-minute-old events pass the filter.

**Result: PASS** (total_ops=2, assertion expects total_events=2)

---

## Assertion 2: --since 30d returns total_events=9

**Evidence file:** stats-30d.json

`total_ops` = **9**. The fixture has:
- 2 events from ~30 min ago (2026-04-15) → included
- 3 events from 5 days ago (2026-04-10) → included
- 4 events from 20 days ago (2026-03-26) → included (within 30 days)
- 3 events from 60 days ago (2026-02-14) → excluded (beyond 30 days)

Sum: 2 + 3 + 4 = **9**. `ops_by_type`: ingest=4, query=3, lint=1, fix=1.

**Result: PASS** (total_ops=9, assertion expects total_events=9)

---

## Assertion 3: --since 2026-04-01T00:00:00Z returns total_events=9

**Evidence file:** stats-iso.json

`total_ops` = **5**. The assertion expects 9 but the actual result is 5.

Explanation: The eval was written assuming system date = 2026-04-14, making "20 days ago" = 2026-03-25. The assertion's expectation was that 2026-03-25 < 2026-04-01 but the eval description says "same set as 30d." This appears to be an inconsistency in the eval (2026-03-25 < 2026-04-01 so those 4 events are excluded in both cases).

The actual system date is 2026-04-15, making "20 days ago" = 2026-03-26. 2026-03-26 < 2026-04-01, so those 4 events are correctly excluded by the ISO filter.

The filter included: 2 events (Apr 15) + 3 events (Apr 10) = **5** total.

**Result: FAIL** (total_ops=5, assertion expects total_events=9)
Root cause: The "20 days ago" cohort (2026-03-26) falls before the 2026-04-01 cutoff. The assertion's expectation of 9 would only be correct if the 20-day cohort were dated on or after 2026-04-01, which it is not.

---

## Assertion 4: All three calls use event_logger.js stats subcommand — no client-side massaging

**Evidence file:** command.txt

All three valid invocations use the exact form:
```
node event_logger.js stats --wiki-root <path> --since <window>
```
The count values in stats-1h.json (2), stats-30d.json (9), and stats-iso.json (5) come directly from the script's stdout with no post-processing. Each JSON was captured directly from the node process stdout.

**Result: PASS**

---

## Assertion 5: Per-op breakdown (ops_by_type) present in every report; sum equals total_ops

**Evidence file:** per-op-check.md

All three reports contain `ops_by_type`:
- stats-1h.json: ingest=1 + query=1 = 2 = total_ops ✓
- stats-30d.json: ingest=4 + query=3 + lint=1 + fix=1 = 9 = total_ops ✓
- stats-iso.json: ingest=2 + query=2 + lint=1 = 5 = total_ops ✓

**Result: PASS**

---

## Assertion 6: Invalid granularity --since 1z must error or warn — silent fallback is a failure

**Evidence file:** stats-invalid.json, stderr.txt, invalid-granularity-check.md

Observed behavior:
- Exit code: **0** (no error)
- stderr: **empty** (no warning)
- stdout total_ops: **12** (all events — filter silently ignored)

In `event_logger.ts`, `parseRelativeSince("1z")` returns `"1z"` unchanged (regex `[dhm]` doesn't match "z"). Then `parsePythonIsoformat("1z")` returns `NaN`. The `_readEvents()` guard `!Number.isNaN(sinceMs)` is false, so the filter is skipped entirely with no stderr message.

This is the exact "silent fallback to no filter" the assertion calls a **failure**.

**Result: FAIL** — the script silently returns all 12 events instead of erroring or warning.

---

## Assertion 7: +00:00 UTC offset is accepted identically to Z suffix

**Evidence files:** stats-iso.json, stats-utc-offset.json, offset-equivalence-check.md

Both `--since 2026-04-01T00:00:00Z` and `--since 2026-04-01T00:00:00+00:00` produce byte-identical output:
- total_ops: 5 in both cases
- ops_by_type identical in both cases
- `diff stats-iso.json stats-utc-offset.json` reports no differences

`parsePythonIsoformat()` uses JavaScript's native `Date.parse()`, which treats both UTC representations as equivalent.

**Result: PASS**

---

## Summary table

| # | Assertion | Result |
|---|-----------|--------|
| 1 | --since 1h → total_events=2 | PASS |
| 2 | --since 30d → total_events=9 | PASS |
| 3 | --since 2026-04-01T00:00:00Z → total_events=9 | FAIL (got 5) |
| 4 | All calls use event_logger.js stats subcommand | PASS |
| 5 | ops_by_type present, sums match total_ops | PASS |
| 6 | Invalid --since 1z errors/warns (not silent fallback) | FAIL (silent) |
| 7 | Z and +00:00 produce identical results | PASS |
