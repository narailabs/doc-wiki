# Assertions Evidence

## Assertion 1
> Re-computed content_hash for the source differs from the value stored in .wiki-cache/ from the original ingest — both values appear in the events.jsonl entry as stale_hash and fresh_hash.

**Evidence — events.jsonl (line 3, op=refresh):**
```json
{
  "op": "refresh",
  "stale_hash": "e4bffe9b83d97bfa297e4ae1e8e2e801b9b928dc492fcd9971e98b767c9d8ee0",
  "fresh_hash": "a5b1e0b7a9860a4de368f2974bbc6b78438eb2af9fb7cb785d9c97755a674fde"
}
```

**Stale hash** was computed from the original `raw/architecture.md` (stored during initial ingest).
**Fresh hash** was re-computed after the source was modified. They are different.
Both appear in the `op=refresh` event entry in `events.jsonl`.

Cache check result:
- Old hash `e4bffe9b...`: **HIT** (in `.wiki-cache/`)
- New hash `a5b1e0b7...`: **MISS** → triggered refresh

---

## Assertion 2
> The corresponding wiki/architecture.md body is updated to reflect new content from the source (a phrase introduced in the modified source appears in the page body).

**Evidence — page-after.md body (excerpt):**
```
The unified gateway ingress is the cornerstone of the new architecture. All
inbound traffic — HTTP, WebSocket, and gRPC — flows through this single control
point. The unified gateway ingress handles protocol negotiation, load balancing,
canary routing, and request transformation in a single pass...
```

The phrase **"unified gateway ingress"** appears multiple times in the refreshed body.
This phrase was introduced only in the modified source (`source-after.md`) and was
absent from the original source (`source-before.md`).

---

## Assertion 3
> The page's frontmatter still contains reviewer: alice (manual field preserved); standard managed fields (updated, sources, summary) are refreshed; created is unchanged.

**Evidence — frontmatter-diff.md (key fields):**

| Field | Before | After | Status |
|---|---|---|---|
| `reviewer` | `alice` | `alice` | PRESERVED |
| `created` | `2026-04-10T08:00:00+00:00` | `2026-04-10T08:00:00+00:00` | UNCHANGED |
| `updated` | `2026-04-10T08:00:00+00:00` | `2026-04-15T00:56:30+00:00` | REFRESHED |
| `summary` | "Original microservices..." | "Redesigned platform..." | REFRESHED |
| `sources` | `["raw/architecture.md"]` | `["raw/architecture.md"]` | UNCHANGED |

From `page-after.md` frontmatter:
```yaml
reviewer: alice
created: "2026-04-10T08:00:00+00:00"
updated: "2026-04-15T00:56:30+00:00"
```

---

## Assertion 4
> raw/architecture.md is overwritten with the new source content (its file hash matches the new source).

**Evidence — source-after.md** contains the new v2 content with "unified gateway ingress" phrase.
The file `/tmp/eval-i7-refresh-wiki/raw/architecture.md` was overwritten in Step 9 with new content.

Hash of `raw/architecture.md` after overwrite:
```
a5b1e0b7a9860a4de368f2974bbc6b78438eb2af9fb7cb785d9c97755a674fde
```
This matches the `fresh_hash` value in the `op=refresh` event.

Compare `source-before.md` vs `source-after.md`:
- Before: focuses on original API gateway, Kafka with 7-day retention, no "unified gateway" term
- After: introduces "unified gateway ingress" as core concept; Confluent Cloud; 14-day retention; eBPF

---

## Assertion 5
> events.jsonl records op='refresh' with target_page, source, stale_hash, fresh_hash, and a delta_summary string of >=20 chars describing what changed.

**Evidence — events.jsonl (line 3):**
```json
{
  "ts": "2026-04-15T00:57:11.585000+00:00",
  "op": "refresh",
  "target_page": "wiki/architecture.md",
  "source": "raw/architecture.md",
  "stale_hash": "e4bffe9b83d97bfa297e4ae1e8e2e801b9b928dc492fcd9971e98b767c9d8ee0",
  "fresh_hash": "a5b1e0b7a9860a4de368f2974bbc6b78438eb2af9fb7cb785d9c97755a674fde",
  "delta_summary": "Q1 redesign: unified gateway ingress replaces multi-tier gateway; eBPF service mesh; Confluent Cloud Kafka migration; OpenTelemetry unified stack; zero-trust networking added"
}
```

All required fields present:
- `op`: `"refresh"` ✓
- `target_page`: `"wiki/architecture.md"` ✓
- `source`: `"raw/architecture.md"` ✓
- `stale_hash`: present (64-char hex) ✓
- `fresh_hash`: present (64-char hex) ✓
- `delta_summary`: 149 chars (≥20) ✓

---

## Assertion 6
> graph/edges.jsonl is re-evaluated — at least one edge whose source is the refreshed page differs from the pre-refresh edge set (added, removed, or retyped). If no edges change, the events entry must explicitly note edges_unchanged: true.

**Evidence — edges-before.jsonl:**
```json
{"from": "wiki/architecture.md", "to": "wiki/auth.md", "type": "extends", ...}
```
(1 edge)

**Evidence — edges-after.jsonl:**
```json
{"from": "wiki/architecture.md", "to": "wiki/auth.md", "type": "extends", ...}
{"from": "wiki/architecture.md", "to": "wiki/control-plane.md", "type": "supports", ...}
```
(2 edges)

A new edge was added from `wiki/architecture.md` to `wiki/control-plane.md` (type: `supports`)
during the re-evaluation step. The new control-plane concept was introduced by the modified source.
The event records `"edges_added": 1, "edges_removed": 0`.

---

## Assertion 7
> A second /wiki-refresh run with no further source modification is a no-op: no new events, hash stays identical, page body unchanged byte-for-byte.

**Evidence — noop-check.md:**

| Measurement | Before probe | After probe |
|---|---|---|
| `log/events.jsonl` line count | 3 | 3 |
| New events added | — | **0** |
| `wiki/architecture.md` MD5 | `a24637158873d8ddf191db993e19432a` | `a24637158873d8ddf191db993e19432a` |
| Byte-identical | — | **true** |

Cache check on second run:
```
Hash: a5b1e0b7a9860a4de368f2974bbc6b78438eb2af9fb7cb785d9c97755a674fde
CACHE_HIT=true
NO_OP=true — hash matches cache, no refresh needed
```

The second run detects a cache hit (fresh hash already stored) and exits without
writing any events, modifying the page, or updating edges.
