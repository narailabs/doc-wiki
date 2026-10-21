# --since 7d filter check

Fixture contains 21 events total. 4 events dated 8 days ago are OUTSIDE the 7-day window:
- 2 ingest (tokens 1500, 1700)
- 2 query (tokens 1000, 1050)

Stats total_ops: 17 → 21 - 4 = 17 ✓ (all 4 older events excluded).

Had they been included, counts would have been: ingest=9, query=8 — but actual output is ingest=7, query=6, confirming the filter ran correctly.
