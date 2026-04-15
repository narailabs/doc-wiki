# Ingest event counts per run

Source events log: `/tmp/eval-i4-ingest-folder/log/events.jsonl`
Total lines:
28

## op=ingest events per run

- run1 -> 8
- run2 -> 0
- run3 -> 1

(total op=ingest events in log = 9; matches 8 + 0 + 1)

## op=cache_hit events per run

- run1 -> 0
- run2 -> 8
- run3 -> 7

(total op=cache_hit events in log = 15; matches 0 + 8 + 7)

## op=ingest_batch_summary events

{"ts": "2026-04-14T20:07:09.142000+00:00", "op": "ingest_batch_summary", "run": "run1", "total_files": 8, "new_ingests": 8, "cache_hits": 0}
{"ts": "2026-04-14T20:07:23.525000+00:00", "op": "ingest_batch_summary", "run": "run2", "total_files": 8, "new_ingests": 0, "cache_hits": 8}
{"ts": "2026-04-14T20:07:39.831000+00:00", "op": "ingest_batch_summary", "run": "run3", "total_files": 8, "new_ingests": 1, "cache_hits": 7}

## Verification

- Run 1: 8 ingest + 0 cache_hit = all fresh
- Run 2: 0 ingest + 8 cache_hit = perfect no-op (content unchanged)
- Run 3: 1 ingest + 7 cache_hit = only auth.md re-processed
