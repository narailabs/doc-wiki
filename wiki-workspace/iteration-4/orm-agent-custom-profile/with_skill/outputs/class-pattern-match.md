# class_pattern match report

## Pattern

```
class\s+(\w+)\s*\(\s*BaseModel\s*\)
```

- Single capture group → class name (group 1).
- Compiled with flags `gm` by `extractor.ts` (see comment at line 96 of
  `/Users/narayan/src/doc-wiki/.claude/agents/lib/wiki_orm/extractor.ts`).
- Applied to the full text of `example.py`.

## Matches in `example.py`

| # | Class name (group 1) | Char offset |
| - | -------------------- | ----------- |
| 1 | `User`               | 327         |
| 2 | `Post`               | 543         |
| 3 | `Comment`            | 758         |

The `class BaseModel` declaration at the top of the file is intentionally
NOT matched — its base-class parens are empty, and the pattern requires
literal `BaseModel` inside the parens. That's the desired scope: `BaseModel`
itself is not an entity.

## Assertion #4 (eval_metadata.json)

> entity_extraction.class_pattern has a single capture group that matches at
> least one class name in example.py (verified by running the pattern
> against the fixture)

**Verdict:** PASS. Three class names captured via a single group.

## Per-class windows produced by R3

Having three class-pattern hits lets extractor.ts carve the file into three
slices before running `table_pattern` / `column_pattern` / relationship
patterns. The slice boundaries follow the class-match positions above:

| Class    | Window start | Window end                |
| -------- | ------------ | ------------------------- |
| User     | 327          | 543 (start of `Post`)     |
| Post     | 543          | 758 (start of `Comment`)  |
| Comment  | 758          | EOF                       |

Each window is passed to `table_pattern.exec(windowText)`, so the first —
and, in this fixture, only — `__table__` match per window is the one that
belongs to that class. This is what lets a plain pattern like
`__table__\s*=\s*["'](\w+)["']` correctly return three different tables
without any bypass trick.
