# doc-wiki benchmark — results

_Generated: 2026-06-04T01:05:42.531Z. 114 runs in dataset._

## Headline

| Repo | Baseline | With doc-wiki | Δ | Baseline $/run | With-docwiki $/run | Atlas $ |
|---|---|---|---|---|---|---|
| cal-com | 94.1% (16/17) | 100.0% (20/20) | 5.9 pp | $0.00 | $0.00 | $2.20 |
| calcom/cal.com | — (0/0) | 100.0% (1/1) | — | — | $0.00 | $0.00 |
| django | 94.4% (17/18) | 100.0% (18/18) | 5.6 pp | $0.00 | $0.00 | $0.00 |
| mastodon | 94.7% (18/19) | 100.0% (18/18) | 5.3 pp | $0.00 | $0.00 | $0.45 |
| **aggregate** | 94.4% (51/54) | 100.0% (57/57) | 5.6 pp | $0.00 | $0.00 | $2.65 |

## Per-run cost summary

- Total Claude spend (baseline runs): $0.00 across 54 runs
- Total Claude spend (with-doc-wiki runs): $0.00 across 57 runs
- Total atlas spend (one per repo): $2.65
- **Grand total: $2.65**

## Per-cell results (with multi-run variance where N>1)

| repo / issue | baseline pass | baseline duration (median, min–max s) | with-doc-wiki pass | wdw duration (s) | Δ pass | atlas $ |
|---|---|---|---|---|---|---|
| cal-com/19163 | 2/3 | 1665 (1644–2637) | 2/2 | 2695 (1981–3408) | 33 pp | $1.20 |
| cal-com/20358 | 3/3 | 1370 (996–3802) | 3/3 | 1977 (1457–2110) | 0 pp | $3.35 |
| cal-com/22319 | 3/3 | 240 (162–305) | 3/3 | 210 (189–295) | 0 pp | $5.90 |
| cal-com/27963 | 1/1 | 211 (211–211) | 1/1 | 390 (390–390) | 0 pp | $0.65 |
| cal-com/27988 | 1/1 | 239 (239–239) | 2/2 | 1437 (1235–1638) | 0 pp | $0.80 |
| cal-com/28034 | — | — | 2/2 | 1224 (1197–1251) | — | $0.60 |
| cal-com/28610 | 2/2 | 1318 (806–1830) | 3/3 | 822 (645–1296) | 0 pp | $1.45 |
| cal-com/28616 | 3/3 | 153 (118–179) | 3/3 | 192 (192–298) | 0 pp | $3.40 |
| cal-com/28764 | 1/1 | 210 (210–210) | 1/1 | 234 (234–234) | 0 pp | $0.00 |
| calcom/cal.com/cal-com#27988 | — | — | 1/1 | 1003 (1003–1003) | — | $0.00 |
| django/36912 | 3/3 | 277 (97–480) | 3/3 | 158 (102–184) | 0 pp | $0.00 |
| django/36961 | 1/1 | 300 (300–300) | 1/1 | 270 (270–270) | 0 pp | $0.00 |
| django/36966 | 1/1 | 375 (375–375) | 1/1 | 454 (454–454) | 0 pp | $0.00 |
| django/37016 | 3/3 | 630 (480–840) | 3/3 | 214 (101–780) | 0 pp | $0.00 |
| django/37024 | 3/3 | 300 (26–300) | 3/3 | 241 (119–364) | 0 pp | $0.00 |
| django/37036 | 2/3 | 120 (43–300) | 3/3 | 840 (335–1162) | 33 pp | $0.00 |
| django/37047 | 1/1 | 480 (480–480) | 1/1 | 265 (265–265) | 0 pp | $0.00 |
| django/37057 | 3/3 | 108 (102–486) | 3/3 | 720 (160–870) | 0 pp | $0.00 |
| mastodon/19985 | 2/3 | 1708 (1380–2700) | 2/2 | 633 (570–695) | 33 pp | $0.00 |
| mastodon/37373 | 2/2 | 1477 (1453–1500) | 2/2 | 749 (202–1295) | 0 pp | $0.00 |
| mastodon/37652 | 1/1 | 418 (418–418) | 1/1 | 449 (449–449) | 0 pp | $0.45 |
| mastodon/37754 | 1/1 | 600 (600–600) | 1/1 | 540 (540–540) | 0 pp | $0.00 |
| mastodon/37948 | 3/3 | 1320 (900–1500) | 3/3 | 578 (135–700) | 0 pp | $0.00 |
| mastodon/38045 | 3/3 | 1465 (1265–1665) | 3/3 | 1964 (1815–5100) | 0 pp | $0.00 |
| mastodon/38203 | 3/3 | 660 (401–3106) | 3/3 | 1842 (1740–1960) | 0 pp | $0.00 |
| mastodon/38376 | 3/3 | 934 (30–960) | 3/3 | 374 (234–1500) | 0 pp | $0.00 |

## Methodology

See [`PLAN.md`](../PLAN.md). Each repo runs `N` real closed issues. For each issue:

1. Clone at parent of the fix commit.
2. Install deps.
3. (With doc-wiki only) build the wiki via `/doc-wiki:atlas`.
4. Run Claude Code with the issue title + body as prompt.
5. Run the test the fix PR added/modified.
6. Success = that test passes. Binary.

Raw run-level data: [`raw.csv`](raw.csv). Per-run transcripts: `runs/<repo>/<issue>/<condition>.json` (not committed; regenerate locally).
