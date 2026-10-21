# Assertions Evidence

One section per assertion from `eval_metadata.json`, citing the relevant artifact file.

---

## Assertion 1
> The answer cites at least 3 distinct wiki pages by relative markdown link, each link resolving to a real file under wiki/

**Evidence file:** `citations-check.md`

The answer contains 5 relative markdown links, all resolving to real files:
- `[auth](../../wiki/auth.md)` → `/tmp/eval-i7-query-wiki/wiki/auth.md` ✓
- `[request-routing](../../wiki/request-routing.md)` → `/tmp/eval-i7-query-wiki/wiki/request-routing.md` ✓
- `[app-server](../../wiki/app-server.md)` → `/tmp/eval-i7-query-wiki/wiki/app-server.md` ✓
- `[db-write-path](../../wiki/db-write-path.md)` → `/tmp/eval-i7-query-wiki/wiki/db-write-path.md` ✓
- `[audit-log](../../wiki/audit-log.md)` → `/tmp/eval-i7-query-wiki/wiki/audit-log.md` ✓

5 ≥ 3. All 5 target files exist.

---

## Assertion 2
> events.jsonl records op='query' with details.search_phase: 'summaries' preceding any per-page reads

**Evidence file:** `events.jsonl`

The second line of `events.jsonl` contains:
```json
{"ts":"2026-04-14T10:00:00.000Z","op":"query","details":{"search_phase":"summaries","pages_read":["wiki/summaries.md","wiki/auth.md",...],...},...}
```
- `op: "query"` ✓
- `details.search_phase: "summaries"` ✓
- `wiki/summaries.md` is the first entry in `pages_read`, preceding all per-page reads ✓

**Also in:** `pages-read.md` — documents the ordering explicitly.

---

## Assertion 3
> details.reduction_ratio in the events entry is >0.8

**Evidence file:** `reduction-ratio-calc.md` and `events.jsonl`

From `events.jsonl`:
```json
"details": {"reduction_ratio": 0.8256, ...}
```

Calculation:
- tokens_in = 2918 (6 files, chars/4)
- tokens_out = 509 (679 words × 0.75 tokens/word)
- ratio = 1 − (509 / 2918) = **0.8256 > 0.8** ✓

---

## Assertion 4
> The answer ends with a '## Knowledge gaps' section listing at least one specific gap: (a) request-id propagation OR (b) error-path rollback

**Evidence file:** `knowledge-gaps-check.md`

The answer ends with:
```
## Knowledge gaps
1. **Request-ID propagation** — ...
2. **Error-path rollback behavior** — ...
```

Both gaps are listed. The section header is `## Knowledge gaps` (exact match). ✓

---

## Assertion 5
> The archive at outputs/queries/<YYYY-MM-DD>-<topic-slug>.md exists with frontmatter containing topic, tags, and created ISO date

**Evidence file:** `answer.md` (copy of the archive)

Archive path: `/tmp/eval-i7-query-wiki/outputs/queries/2026-04-14-request-lifecycle.md`
- Filename pattern: `2026-04-14-request-lifecycle.md` (YYYY-MM-DD + topic slug) ✓
- Frontmatter `topic: request-lifecycle` ✓
- Frontmatter `tags: [auth, jwt, nginx, routing, app-server, postgres, audit, lifecycle]` ✓
- Frontmatter `created: 2026-04-14T00:00:00Z` (ISO date) ✓

---

## Assertion 6
> The synthesised answer mentions concrete artifacts from at least 3 of the 5 pages (JWT, nginx, pg connection pool, audit_log table)

**Evidence file:** `artifacts-check.md`

All four named assertion terms found in answer.md:
- JWT (from wiki/auth.md) ✓
- nginx (from wiki/request-routing.md) ✓
- pg connection pool (from wiki/db-write-path.md) ✓
- audit_log (from wiki/audit-log.md) ✓

Additional terms also present: sessions table, X-Forwarded-For, worker pool.

---

## Assertion 7
> The events entry includes tokens_in, tokens_out, and a non-zero pages_read[] array of length >=3

**Evidence file:** `events.jsonl`

From the query event:
```json
{
  "tokens_in": 2918,
  "tokens_out": 509,
  "details": {
    "pages_read": [
      "wiki/summaries.md",
      "wiki/auth.md",
      "wiki/request-routing.md",
      "wiki/app-server.md",
      "wiki/db-write-path.md",
      "wiki/audit-log.md"
    ]
  }
}
```
- `tokens_in: 2918` (non-zero) ✓
- `tokens_out: 509` (non-zero) ✓
- `pages_read` array length = 6 ≥ 3 ✓
