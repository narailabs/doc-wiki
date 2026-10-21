# Content Hashes

## Stale Hash (original ingest)
```
e4bffe9b83d97bfa297e4ae1e8e2e801b9b928dc492fcd9971e98b767c9d8ee0
```
Computed from: original `raw/architecture.md` (2195 bytes, ends with newline)
Method: `crypto.createHash('sha256').update(content, 'utf8').digest('hex')`
Stored in: `.wiki-cache/e4bffe9b83d97bfa297e4ae1e8e2e801b9b928dc492fcd9971e98b767c9d8ee0.json`

## Fresh Hash (after source edit)
```
a5b1e0b7a9860a4de368f2974bbc6b78438eb2af9fb7cb785d9c97755a674fde
```
Computed from: modified `raw/architecture.md` (new v2 content introducing "unified gateway ingress")
Method: same as above
Stored in: `.wiki-cache/a5b1e0b7a9860a4de368f2974bbc6b78438eb2af9fb7cb785d9c97755a674fde.json`

## Cache Check Result
- Checking new content against cache: **MISS** (stale — hash not in cache)
- Checking old content against cache: **HIT** (old hash still stored from original ingest)
- This difference confirms the source was modified since the last ingest.

## Both Hashes Appear in events.jsonl
See `events.jsonl` line 3 (op=refresh):
- `stale_hash`: `e4bffe9b83d97bfa297e4ae1e8e2e801b9b928dc492fcd9971e98b767c9d8ee0`
- `fresh_hash`: `a5b1e0b7a9860a4de368f2974bbc6b78438eb2af9fb7cb785d9c97755a674fde`
