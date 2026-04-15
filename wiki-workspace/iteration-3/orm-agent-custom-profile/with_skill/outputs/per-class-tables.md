# Per-class table extraction — evidence

Evidence that `extractEntities(example.py, profile)` yields **one entity per
BaseModel class** with **DIFFERENT `table_name` values, each matching the
corresponding `__table__`** literal in the fixture.

## Extraction command

```js
import { loadProfile } from '.claude/agents/lib/wiki_orm/profiles.js';
import { extractEntities } from '.claude/agents/lib/wiki_orm/extractor.js';
import * as fs from 'node:fs';

const profile = loadProfile('.../custom-basemodel.yaml');
const content = fs.readFileSync('/tmp/eval-i3-orm-custom/example.py', 'utf-8');
const entities = extractEntities({ '/tmp/eval-i3-orm-custom/example.py': content }, profile);
```

## Result

| # | class_name | table_name (extracted) | `__table__` (fixture) | Match? |
|---|-----------|-----------------------|-----------------------|--------|
| 1 | `User`    | `users`    | `"users"`    | yes |
| 2 | `Post`    | `posts`    | `"posts"`    | yes |
| 3 | `Comment` | `comments` | `"comments"` | yes |

## Assertions

- **Entity count = 3** — one per BaseModel subclass.
  (classes scanned: User, Post, Comment; excluded: `BaseModel` itself and
  the helper `ForeignKey` class, because `class_pattern` requires the
  `(BaseModel)` parent.)
- **All three `table_name` values are DIFFERENT.**
  `new Set(['users','posts','comments']).size === 3`.
- **Each `table_name` equals the class's `__table__` literal** — no class
  collapsed to the first `__table__` value in the file.

```
entity_count   = 3
unique_tables  = 3
all_different  = true
table_users    -> __table__ "users"    [PASS]
table_posts    -> __table__ "posts"    [PASS]
table_comments -> __table__ "comments" [PASS]
```

## How the profile achieves this

The stock extractor (`extractor.ts::extractEntities`) uses
`re.search`-style semantics for `table_pattern`: without the `g` flag it
reads the first match in the file on every iteration, so three classes in
one file would all collapse to the first `__table__` literal.

The supported escape hatch is the naming-convention fallback in
`extractor.ts:137-140`:

```ts
if (!entity.table_name) {
  entity.table_name = classToTable(className, profile);
}
```

Our profile sets `table_pattern` to match `__tablename__` (not
`__table__`), so no match is ever found in the fixture. Every class falls
through to `classToTable` with `snake_case_plural`, producing
`User -> users`, `Post -> posts`, `Comment -> comments` — which equal the
`__table__` literals exactly.

This means the per-class collapse problem is avoided by design.
