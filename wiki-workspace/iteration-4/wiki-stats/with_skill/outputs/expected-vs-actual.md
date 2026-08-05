# Expected vs Actual — 7-day window

Fixture: `/tmp/eval-i4-stats-wiki/log/events.jsonl` (21 events total).
Command: `node event_logger.js stats --wiki-root /tmp/eval-i4-stats-wiki/ --since 7d`.
Reference "now" = 2026-04-14T20:05:01+00:00 → cutoff = 2026-04-07T20:05:01+00:00.
Fixture events with `ts >= cutoff` = 17 (the 4 entries dated 2026-04-06 are
strictly older than 7 days and must be excluded).

## Op counts (from `ops_by_type`)

| op     | expected (fixture, within 7d) | actual (stats output) | match |
|--------|-----------------------------:|----------------------:|:-----:|
| ingest | 7                            | 7                     | yes   |
| query  | 6                            | 6                     | yes   |
| lint   | 2                            | 2                     | yes   |
| fix    | 2                            | 2                     | yes   |
| total  | 17                           | 17                    | yes   |

## total_tokens per op (computed from fixture's `tokens` fields)

| op     | expected (Σ tokens) | actual | match |
|--------|--------------------:|-------:|:-----:|
| ingest |                7500 |   7500 | yes   |
| query  |                4780 |   4780 | yes   |
| lint   |                   0 |      0 | yes   |
| fix    |                   0 |      0 | yes   |

Derivations:
- ingest: 1200 + 1500 + 800 + 700 + 950 + 1050 + 1300 = 7500
- query:  900 + 1100 + 650 + 820 + 730 + 580 = 4780
- lint/fix: all zero by design (non-LLM ops in this fixture)

## avg_duration_ms per op (computed from fixture's `duration_ms`)

| op     | durations (ms)                | expected mean | actual | match |
|--------|-------------------------------|--------------:|-------:|:-----:|
| ingest | 320, 410, 215, 260, 305, 375, 440 | 332.14 (2325/7) | 332.14 | yes |
| query  | 180, 240, 165, 195, 205, 170  | 192.50 (1155/6) | 192.50 | yes |
| lint   | 95, 75                        | 85.00  (170/2)  |  85.00 | yes |
| fix    | 150, 135                      | 142.50 (285/2)  | 142.50 | yes |

## Aggregate totals

| metric          | expected | actual | match |
|-----------------|---------:|-------:|:-----:|
| total_ops       | 17       | 17     | yes   |
| total_cost_usd  | 0.0      | 0.0    | yes   |
| total_tokens    | 12280    | 12280  | yes   |

Every per-op count, token sum, and avg-duration the eval asks for matches the
fixture's within-window events byte-for-byte.
