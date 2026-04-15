# Per-class table_names — R3 per-class windowing test

## Setup

- Extractor: `/Users/narayan/src/doc-wiki/.claude/agents/lib/wiki_orm/extractor.js`
  (compiled from `extractor.ts` with the R3 per-class windowing fix).
- Profile: `custom-basemodel.yaml`
  - `class_pattern`: `class\s+(\w+)\s*\(\s*BaseModel\s*\)`
  - `table_pattern`: `__table__\s*=\s*["'](\w+)["']`   ← straightforward,
    matches EVERY `__table__` in the file. No bypass.
  - `column_pattern`: `\n {4}(\w+)\s*=`
  - relationship: `ForeignKey\(`
- Fixture: `example.py` — 3 classes defined sequentially, each with its own
  `__table__`:
  - `User`    → `users`
  - `Post`    → `posts`
  - `Comment` → `comments`

## `extractEntities` output

```
entity count: 3

  class_name:    User
  table_name:    users
  columns:       __table__, __columns__, id, email, name, created_at
  relationships: (none)
  source_file:   /tmp/eval-i4-orm-custom/example.py

  class_name:    Post
  table_name:    posts
  columns:       __table__, __columns__, id, title, body, author_id
  relationships: foreign_key->?
  source_file:   /tmp/eval-i4-orm-custom/example.py

  class_name:    Comment
  table_name:    comments
  columns:       __table__, __columns__, id, post_id, author_id, body
  relationships: foreign_key->?, foreign_key->?
  source_file:   /tmp/eval-i4-orm-custom/example.py
```

## Assertion #6

> When the profile is applied to an example.py containing THREE BaseModel
> classes with DIFFERENT `__table__` values, extractEntities yields 3
> entities with 3 DIFFERENT table_names — NOT all three collapsing to the
> first table (the per-class windowing fix must hold even with a
> straightforward table_pattern that matches every `__table__` occurrence).

| Check                                           | Observed                                | Pass |
| ----------------------------------------------- | --------------------------------------- | ---- |
| entity count                                    | 3                                       | YES  |
| `table_names`                                   | `["users", "posts", "comments"]`        | YES  |
| `new Set(table_names).size` (distinct count)    | 3                                       | YES  |
| first entity table != "posts" or "comments"     | `users`                                 | YES  |
| each table matches that class's `__table__`     | see fixture                             | YES  |

**Verdict:** PASS — three entities, three distinct `table_names`, each
matching its class's own `__table__` attribute.

## Why this exercises R3

Before R3, extractor.ts ran `table_pattern` once against the *whole* file
with Python's `re.search` semantics (first match wins globally). With three
classes that each declare `__table__`, the old behaviour collapsed all
three entities to `"users"` (the first match). The R3 fix slices the file
into per-class windows using `class_pattern` offsets, then runs
`table_pattern.exec(windowText)` inside each window. A straightforward
`__table__\s*=\s*["'](\w+)["']` now returns `users` / `posts` / `comments`
for the User / Post / Comment windows respectively — exactly what we see.

As a secondary sanity check, the per-class `columns` lists are also
disjoint (e.g. `email` appears only in User, `author_id` only in Post and
Comment), confirming `column_pattern` and `relationship_patterns` are
windowed too, not just `table_pattern`.
