# Assertions Evidence — Iteration 8

Evidence for each of the 7 assertions in eval_metadata.json
(eval_id=12, wiki-stats-since). Two assertions flipped from FAIL (iter-7)
to PASS in this iteration: **A3** (revised expected value) and **A6** (W1 fix).

---

## Assertion 1: --since 1h returns total_events=2

**Evidence file:** stats-1h.json

`total_ops` = **2**. The fixture has 2 events with timestamps at
2026-04-15T01:34:21Z and 2026-04-15T01:39:21Z, both approximately 25–30
minutes before run time. The `--since 1h` filter computes
`parseRelativeSince("1h")` → a timestamp 1 hour before now, which passes
both 30-minute-old events and excludes all other cohorts (5d, 20d, 60d).

`ops_by_type`: ingest=1, query=1. Sum=2=total_ops.

**Result: PASS** (total_ops=2, assertion expects total_events=2)

---

## Assertion 2: --since 30d returns total_events=9

**Evidence file:** stats-30d.json

`total_ops` = **9**. The fixture has:
- 2 events from ~30 min ago (2026-04-15) → included (within 30d)
- 3 events from 5 days ago (2026-04-10) → included (within 30d)
- 4 events from 20 days ago (2026-03-26) → included (within 30d; 30d cutoff
  is 2026-03-16, and 2026-03-26 > 2026-03-16)
- 3 events from 60 days ago (2026-02-14) → excluded (beyond 30d)

Sum: 2 + 3 + 4 = **9**. `ops_by_type`: ingest=4, query=3, lint=1, fix=1.

**Result: PASS** (total_ops=9, assertion expects total_events=9)

---

## Assertion 3: --since 2026-04-01T00:00:00Z returns total_events=5
### *** FLIPPED from FAIL (iter-7) to PASS — E1 revised ***

**Evidence file:** stats-iso.json

`total_ops` = **5**. The assertion was revised in iteration-8 from
"returns total_events=9" to "returns total_events=5" to match the arithmetic
reality.

Cohort analysis against the 2026-04-01T00:00:00Z cutoff:
- 2 events on 2026-04-15 (30 min ago) → 2026-04-15 >= 2026-04-01 → **included**
- 3 events on 2026-04-10 (5 days ago) → 2026-04-10 >= 2026-04-01 → **included**
- 4 events on 2026-03-26 (20 days ago) → 2026-03-26 < 2026-04-01 → **excluded**
- 3 events on 2026-02-14 (60 days ago) → 2026-02-14 < 2026-04-01 → **excluded**

Included: 2 + 3 = **5**. `ops_by_type`: ingest=2, query=2, lint=1. Sum=5.

In iteration-7 this was a FAIL because the assertion incorrectly expected 9
(it assumed 20-days-ago would also be included, but 2026-03-26 < 2026-04-01).
The eval assertion text has now been corrected (E1 fix), and the actual output
of 5 now matches.

**Result: PASS** (total_ops=5, assertion expects total_events=5)

---

## Assertion 4: All calls use event_logger.js stats subcommand — no client-side massaging

**Evidence file:** command.txt

All five invocations use the exact form:
```
node event_logger.js stats --wiki-root <path> --since <window>
```
The count values in stats-1h.json (2), stats-30d.json (9), stats-iso.json (5),
and stats-utc-offset.json (5) come directly from each node process's stdout
with no post-processing. Each JSON was captured directly from the script.

**Result: PASS**

---

## Assertion 5: Per-op breakdown (ops_by_type) present in every report; sum equals total_ops

**Evidence file:** per-op-check.md

All four valid-filter reports contain `ops_by_type`:
- stats-1h.json: ingest=1 + query=1 = **2** = total_ops ✓
- stats-30d.json: ingest=4 + query=3 + lint=1 + fix=1 = **9** = total_ops ✓
- stats-iso.json: ingest=2 + query=2 + lint=1 = **5** = total_ops ✓
- stats-utc-offset.json: ingest=2 + query=2 + lint=1 = **5** = total_ops ✓

**Result: PASS**

---

## Assertion 6: Invalid --since 1z exits code 2 with stderr error (not silent fallback)
### *** FLIPPED from FAIL (iter-7) to PASS — W1 fix ***

**Evidence files:** stats-invalid.stdout.txt, stats-invalid.stderr.txt,
stats-invalid.exitcode.txt, invalid-granularity-check.md

Observed behavior with W1 fix in place:

| Observable  | Value                                                            |
|-------------|------------------------------------------------------------------|
| exit code   | **2**                                                            |
| stdout      | **(empty — machine-readable channel uncontaminated)**            |
| stderr      | `[event_logger] error: --since value "1z" is not a valid relative duration (e.g. 7d, 24h, 15m) or absolute ISO timestamp (YYYY-MM-DD...)` |

The fix (lines 487–494 in event_logger.js) validates `--since` at the CLI
boundary before any I/O: `1z` fails both `^\d+[dhm]$` and `^\d{4}-\d{2}-\d{2}`,
so the function returns 2 immediately.

In iteration-7 the same invocation returned exit code 0, empty stderr, and
all 12 events on stdout (silent fallback to "no filter"). That was the exact
failure mode described in the assertion. W1 is now fixed.

**Result: PASS** (FLIPPED from FAIL in iter-7 to PASS in iter-8)

---

## Assertion 7: +00:00 UTC offset is accepted identically to Z suffix

**Evidence files:** stats-iso.json, stats-utc-offset.json, offset-equivalence-check.md

Both `--since 2026-04-01T00:00:00Z` and `--since 2026-04-01T00:00:00+00:00`
produce byte-identical output:
- total_ops: **5** in both cases
- ops_by_type: ingest=2, query=2, lint=1 in both cases
- `diff stats-iso.json stats-utc-offset.json` reports no differences

`parsePythonIsoformat()` delegates to `Date.parse()`, which treats both UTC
representations as equivalent (same epoch milliseconds).

**Result: PASS**

---

## Summary table

| # | Assertion | iter-7 | iter-8 |
|---|-----------|--------|--------|
| 1 | --since 1h → total_events=2 | PASS | PASS |
| 2 | --since 30d → total_events=9 | PASS | PASS |
| 3 | --since 2026-04-01T00:00:00Z → total_events=5 | FAIL (got 5, expected 9) | **PASS** (E1 revised) |
| 4 | All calls use event_logger.js stats subcommand | PASS | PASS |
| 5 | ops_by_type present, sums match total_ops | PASS | PASS |
| 6 | Invalid --since 1z errors exit=2, not silent | FAIL (silent, exit=0) | **PASS** (W1 fixed) |
| 7 | Z and +00:00 produce identical results | PASS | PASS |

**iter-8 result: 7/7 PASS** (A3 and A6 flipped from FAIL to PASS)
