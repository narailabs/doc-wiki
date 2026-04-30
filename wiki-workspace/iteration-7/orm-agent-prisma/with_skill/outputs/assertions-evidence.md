# Assertions Evidence — orm-agent-prisma (eval id 4)

Run date: 2026-04-14
Fixture: `agents/wiki-orm-agent/evals/fixtures/prisma/schema.prisma`
Profile: prisma

---

## Assertion 1
> All three models (User, Post, Comment) are extracted into detected-entities.json as separate entries

**Evidence:**
`detected-entities.json` contains `"entities"` array with 3 items:
- `{ "class_name": "User", "table_name": "users", ... }`
- `{ "class_name": "Post", "table_name": "posts", ... }`
- `{ "class_name": "Comment", "table_name": "comments", ... }`

**Result: evidence supports PASS**

---

## Assertion 2
> Each entity's table_name matches the @@map(...) value in the fixture (User→'users', Post→'posts', Comment→'comments')

**Evidence:**
| class_name | table_name | fixture @@map | match? |
|---|---|---|---|
| User | users | `@@map("users")` | yes |
| Post | posts | `@@map("posts")` | yes |
| Comment | comments | `@@map("comments")` | yes |

**Result: evidence supports PASS**

---

## Assertion 3
> Every @relation(fields: [...], references: [...]) field produces a relationship with a non-empty target_entity

**Evidence:**
All relationships in `detected-entities.json` have `"target_entity": ""`. Examples:
- User → `{ "type": "one_to_many", "target_entity": "" }`
- Post → `{ "type": "relationship", "target_entity": "" }`, `{ "type": "one_to_many", "target_entity": "" }`
- Comment → `{ "type": "relationship", "target_entity": "" }`

The prisma.yaml `relationship_detection.patterns` only captures whether `@relation` or `[]`
appears, not which model is being referenced. The extractor does not resolve the model name
from the field type (e.g., `User`, `Post`, `Comment`).

**Result: evidence does NOT support PASS — all target_entity values are empty strings**

---

## Assertion 4
> One-to-many sides (posts Post[]) produce type one_to_many; many-to-one inverse (author User @relation(...)) produces type many_to_one, both with correct target_entity

**Evidence:**
- `posts Post[]` in User entity → type `"one_to_many"` — CORRECT type
- `author User @relation(...)` in Post entity → type `"relationship"` — INCORRECT (expected `many_to_one`)
- `comments Comment[]` in Post entity → type `"one_to_many"` — CORRECT type
- `post Post @relation(...)` in Comment entity → type `"relationship"` — INCORRECT (expected `many_to_one`)
- All `target_entity` values are `""` — INCORRECT

The `relationship_detection.patterns` in `prisma.yaml` does not distinguish `many_to_one`
from a generic `@relation` occurrence. The `[]` pattern catches `one_to_many` correctly,
but the `@relation` pattern only maps to the generic type `"relationship"`.

**Result: evidence does NOT support PASS — many_to_one type is wrong, and target_entity is empty for all**

---

## Assertion 5
> Generated database-mapping.md frontmatter has type='entity' and orm_profile='prisma'

**Evidence:**
Frontmatter in `database-mapping.md` (lines 1–10):
```
type: entity
orm_profile: prisma
```
Both fields are present with correct values.

**Result: evidence supports PASS**

---

## Assertion 6
> Mermaid erDiagram contains nodes 'users', 'posts', 'comments' and at least one edge ||--o{ linking users→posts AND another linking posts→comments

**Evidence:**
Generated Mermaid block:
```
erDiagram
    users ||--o{ users_rel : ""
    posts ||--o{ posts_rel : ""
    comments ||--o{ comments_rel : ""
```
- Source nodes `users`, `posts`, `comments` appear as left-hand sides of edges.
- Target nodes are synthetic placeholders `users_rel`, `posts_rel`, `comments_rel` — NOT actual table names.
- The edge `users ||--o{ posts` does NOT appear.
- The edge `posts ||--o{ comments` does NOT appear.

**Result: evidence does NOT support PASS — required edges absent; targets are placeholder nodes, not real table names**

---

## Assertion 7
> mermaid_lint.js reports no issues on the generated page

**Evidence:**
Command: `node mermaid_lint.js --page /tmp/eval-i7-orm-prisma/database-mapping.md`
Output: `[]`

The lint passes because:
1. `erDiagram` is a recognized diagram type.
2. `erDiagram` is in `_RELATIONSHIP_BRACKET_TYPES` so bracket-balance checking is skipped.
3. The placeholder edge syntax (`users ||--o{ users_rel : ""`) is structurally valid.

**Result: evidence supports PASS**

---

## Summary

| # | Assertion (short) | Evidence supports |
|---|---|---|
| 1 | 3 entities extracted | PASS |
| 2 | table_name matches @@map | PASS |
| 3 | non-empty target_entity on all @relation fields | FAIL |
| 4 | one_to_many / many_to_one classification correct with target_entity | FAIL |
| 5 | frontmatter type='entity', orm_profile='prisma' | PASS |
| 6 | Mermaid edges users→posts and posts→comments | FAIL |
| 7 | mermaid_lint reports no issues | PASS |

**Passing: 4 of 7**

Root cause of failures (A3, A4, A6): The prisma.yaml profile's `relationship_detection.patterns`
does not carry target model information. The pattern `{ pattern: "@relation", type: relationship }`
fires but does not extract the adjacent field type (`User`, `Post`, `Comment`). Similarly, the
`{ pattern: "\\[\\]", type: one_to_many }` fires but does not capture the model name before `[]`.
The extractor would need a different regex or a multi-capture pattern to populate `target_entity`.
