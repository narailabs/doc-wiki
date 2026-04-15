# Pages Read

Ordered list of wiki files read during the query, in the sequence they were accessed.

| Step | Phase | File | Tokens (approx) |
|------|-------|------|-----------------|
| 1 | summaries-first (Step A) | wiki/summaries.md | 339 |
| 2 | per-page read (Step B) | wiki/auth.md | 532 |
| 3 | per-page read (Step B) | wiki/request-routing.md | 493 |
| 4 | per-page read (Step B) | wiki/app-server.md | 504 |
| 5 | per-page read (Step B) | wiki/db-write-path.md | 530 |
| 6 | per-page read (Step B) | wiki/audit-log.md | 520 |
| — | synthesis (Step C) | (output generated) | 509 out |

**Total pages read: 6** (summaries.md + 5 wiki pages)  
**Total tokens_in: 2918**  
**tokens_out: 509**  
**reduction_ratio: 0.8256**

## Search Phase Evidence

The `details.search_phase: "summaries"` field in `events.jsonl` records that the first read was `wiki/summaries.md`, and per-page reads followed. No full wiki page was read before the summaries file.
