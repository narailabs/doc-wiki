# Entities Check

## Source

`detected-entities.json` — produced by orm_detect.js with `--profile prisma`

## Assertion: 3 entities extracted, each with correct table_name from @@map

The JSON contains `"entities"` with 3 entries:

| class_name | table_name | Source @@map in fixture |
|---|---|---|
| User | users | `@@map("users")` |
| Post | posts | `@@map("posts")` |
| Comment | comments | `@@map("comments")` |

## Evidence (from detected-entities.json)

```json
[
  { "class_name": "User",    "table_name": "users"    },
  { "class_name": "Post",    "table_name": "posts"    },
  { "class_name": "Comment", "table_name": "comments" }
]
```

## Verdict

- **3 entities extracted**: PASS — User, Post, Comment are all present.
- **table_name from @@map**: PASS — users, posts, comments match the fixture exactly.
- **columns**: FAIL — all entities have `"columns": []`; the prisma.yaml column_pattern
  `"^\\s+(\\w+)\\s+\\w+"` should match fields but the extractor returned 0 columns for
  all three models.
