# Per-Op Check — Assertion 5

Verifies that `ops_by_type` (a.k.a. `by_op`) is present in every report
and that the sum of all per-op counts equals `total_ops`.

## stats-1h.json (`--since 1h`)

| op     | count |
|--------|-------|
| ingest | 1     |
| query  | 1     |
| **SUM**| **2** |

`total_ops` = 2. Sum of ops_by_type = 1 + 1 = **2**. Match: YES

## stats-30d.json (`--since 30d`)

| op     | count |
|--------|-------|
| ingest | 4     |
| query  | 3     |
| lint   | 1     |
| fix    | 1     |
| **SUM**| **9** |

`total_ops` = 9. Sum of ops_by_type = 4 + 3 + 1 + 1 = **9**. Match: YES

## stats-iso.json (`--since 2026-04-01T00:00:00Z`)

| op     | count |
|--------|-------|
| ingest | 2     |
| query  | 2     |
| lint   | 1     |
| **SUM**| **5** |

`total_ops` = 5. Sum of ops_by_type = 2 + 2 + 1 = **5**. Match: YES

## stats-utc-offset.json (`--since 2026-04-01T00:00:00+00:00`)

| op     | count |
|--------|-------|
| ingest | 2     |
| query  | 2     |
| lint   | 1     |
| **SUM**| **5** |

`total_ops` = 5. Sum of ops_by_type = 2 + 2 + 1 = **5**. Match: YES

## Conclusion

All four reports include `ops_by_type`. In every case the sum across ops
equals `total_ops`. Assertion 5: **PASS**
