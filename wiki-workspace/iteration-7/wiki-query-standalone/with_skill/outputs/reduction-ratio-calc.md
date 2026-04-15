# Reduction Ratio Calculation

## Formula

```
reduction_ratio = 1 - (tokens_out / tokens_in)
```

where:
- `tokens_in` = total tokens consumed reading all wiki pages (denominator)
- `tokens_out` = tokens produced in the synthesised answer (numerator for subtraction)

Token estimate method: `chars / 4` for input pages; `words * 0.75` for output prose.

## Denominator: tokens_in (total pages read)

| File | Chars | Tokens (chars/4) |
|------|-------|-----------------|
| wiki/summaries.md | 1358 | 339 |
| wiki/auth.md | 2131 | 532 |
| wiki/request-routing.md | 1972 | 493 |
| wiki/app-server.md | 2018 | 504 |
| wiki/db-write-path.md | 2120 | 530 |
| wiki/audit-log.md | 2081 | 520 |
| **Total** | **11680** | **2918** |

## Numerator: tokens_out (synthesis answer output)

| Metric | Value |
|--------|-------|
| Answer body word count | 679 words |
| Token estimate (words × 0.75) | 509 tokens |

## Result

```
reduction_ratio = 1 - (509 / 2918) = 1 - 0.1744 = 0.8256
```

**0.8256 > 0.8** — assertion passes.

## Interpretation

The query consumed 2918 tokens of reading context and produced 509 tokens of synthesised output — a compression ratio of ~5.7:1. This is consistent with a summaries-first search strategy that reads broadly and synthesises narrowly.
