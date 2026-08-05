# preamble-check

Goal: verify that content **above** `<!-- wiki-mermaid: start -->` and **below** `<!-- wiki-mermaid: end -->` is byte-for-byte identical pre- vs post-run. Only the region between the markers may change.

## Regions (byte-exact)

ABOVE start marker:

```
---
title: Schema
type: entity
---
# Schema overview
Preamble paragraph that must not be touched.
```

BELOW end marker:

```

Trailing paragraph that must not be touched.
```

(Leading newline in BELOW is intentional — it sits between the end marker and the trailing paragraph in both files.)

## sha256 of outer regions

| Region | target-before.md | target-after.md | Equal? |
|--------|------------------|-----------------|:------:|
| ABOVE `<!-- wiki-mermaid: start -->` | `9180401658c083506007dcf8858e3422e1a07da3421b462ede89c612c856e0d5` | `9180401658c083506007dcf8858e3422e1a07da3421b462ede89c612c856e0d5` | yes |
| BELOW `<!-- wiki-mermaid: end -->`   | `f3f03f0984e016dc099ef401dd22b5f3f19a0b74559fb9eed18113686a8f720e` | `f3f03f0984e016dc099ef401dd22b5f3f19a0b74559fb9eed18113686a8f720e` | yes |

Both hashes match exactly — no byte drift above or below the markers.

## BETWEEN-markers length

| Region | target-before.md | target-after.md |
|--------|-----------------:|----------------:|
| Between `start` and `end` markers | 21 bytes (`\n(stale placeholder)\n`) | 237 bytes (mermaid block) |

The only region that changed is the managed span between the markers — exactly as the F2 contract requires.

## Full-file sha256 (context)

| File | sha256 |
|------|--------|
| target-before.md | `85de199da2c8d998736deff12beb10a859d255b34736aa2614b32d111ac36cf4` |
| target-after.md  | `56ca914c5295b27986f522d2ddf12194d00f7d30817bd84e510bc2d83185cb62` |

## Diff (excluding the managed region)

Constructing a "masked" view of each file — replace the content between the markers (exclusive) with a placeholder and diff:

```diff
(no changes outside markers)
```

Equivalent assertion: `sha256(ABOVE_before) == sha256(ABOVE_after)` AND `sha256(BELOW_before) == sha256(BELOW_after)` — both hold.
