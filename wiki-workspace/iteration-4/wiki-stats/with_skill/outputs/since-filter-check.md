# `--since 7d` Filter Check

Goal: verify the four events dated 2026-04-06 (8 days before "now" = 2026-04-14)
are excluded from the `--since 7d` result.

## Counts

| source                                              | count |
|-----------------------------------------------------|------:|
| `wc -l` of fixture `events.jsonl`                   |    21 |
| `total_ops` reported by stats output                |    17 |
| **diff (excluded by `--since 7d`)**                 | **4** |

17 + 4 = 21. ✓

## The 4 excluded events (all dated 2026-04-06, ~8 days old)

Expected cutoff (at run time): ~2026-04-07T20:05:01+00:00. Every event below
has `ts < cutoff` and therefore does not contribute to any `ops_by_type`
bucket:

```
{"ts":"2026-04-06T08:15:42+00:00","op":"ingest","source":"old-wiki/export-1","tokens":2100,"duration_ms":495}
{"ts":"2026-04-06T10:33:21+00:00","op":"ingest","source":"old-wiki/export-2","tokens":1850,"duration_ms":460}
{"ts":"2026-04-06T14:01:17+00:00","op":"query","q":"legacy billing spec","tokens":610,"duration_ms":185}
{"ts":"2026-04-06T16:48:09+00:00","op":"query","q":"deprecated endpoints","tokens":540,"duration_ms":155}
```

Breakdown of excluded ops: 2× ingest, 2× query (matching the fixture plan).

## Proof by counter-factual

If the `--since` filter had been ignored, `ops_by_type` would read:

| op     | actual | what it would be without filter | excluded |
|--------|-------:|--------------------------------:|---------:|
| ingest |      7 |                               9 |        2 |
| query  |      6 |                               8 |        2 |
| lint   |      2 |                               2 |        0 |
| fix    |      2 |                               2 |        0 |
| total  |     17 |                              21 |        4 |

Observed counts match the filtered column exactly — the 7-day window is
honored. The filter is implemented in `event_logger.ts::_readEvents` (line
~184): entries whose parsed `ts` is `< sinceMs` are skipped before any
aggregation, and `parseRelativeSince("7d")` converts to an absolute ISO
timestamp via `Date.now() - 7*86_400_000`.
