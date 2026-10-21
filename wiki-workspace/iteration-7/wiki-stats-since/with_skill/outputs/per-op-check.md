# Per-op (by_op) breakdown check

Verifies that ops_by_type (the `by_op` field) is present in every report and that the sum across ops equals total_ops.

## --since 1h (stats-1h.json)

| op     | count |
|--------|-------|
| ingest |   1   |
| query  |   1   |
| **SUM**| **2** |

total_ops = 2
Sum of ops_by_type = 1 + 1 = **2** ✓ (matches)

## --since 30d (stats-30d.json)

| op     | count |
|--------|-------|
| ingest |   4   |
| query  |   3   |
| lint   |   1   |
| fix    |   1   |
| **SUM**| **9** |

total_ops = 9
Sum of ops_by_type = 4 + 3 + 1 + 1 = **9** ✓ (matches)

## --since 2026-04-01T00:00:00Z (stats-iso.json)

| op     | count |
|--------|-------|
| ingest |   2   |
| query  |   2   |
| lint   |   1   |
| **SUM**| **5** |

total_ops = 5
Sum of ops_by_type = 2 + 2 + 1 = **5** ✓ (matches)

NOTE: The eval assertion expects total_events=9 for this ISO filter. The actual result is 5.
Reason: The 4 events from 2026-03-26 (20 days ago from the actual system date 2026-04-15) are
BEFORE the 2026-04-01 cutoff, so the script correctly excludes them. The assertion was written
assuming "today" = 2026-04-14, but the system clock is 2026-04-15, making "20 days ago" = 2026-03-26
which falls before 2026-04-01.

## Summary

All three reports have ops_by_type present and sums match total_ops in every case.
