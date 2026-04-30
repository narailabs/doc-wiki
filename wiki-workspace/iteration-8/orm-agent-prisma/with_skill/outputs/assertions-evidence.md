# Assertions Evidence — orm-agent-prisma (eval id 4) — Iteration 8

Run date: 2026-04-14
Fixture: `agents/wiki-orm-agent/evals/fixtures/prisma/schema.prisma`
Profile: prisma
Reference: iter-7 evidence at `wiki-workspace/iteration-7/orm-agent-prisma/with_skill/outputs/assertions-evidence.md`

---

## Assertion 1
> All three models (User, Post, Comment) are extracted into detected-entities.json as separate entries

**Evidence:**
`detected-entities.json` contains `"entities"` array with 3 items:
- `{ "class_name": "User", "table_name": "users", ... }`
- `{ "class_name": "Post", "table_name": "posts", ... }`
- `{ "class_name": "Comment", "table_name": "comments", ... }`

**Result: PASS** (same as iter-7 — unchanged)

---

## Assertion 2
> Each entity's table_name matches the @@map(...) value in the fixture (User→'users', Post→'posts', Comment→'comments')

**Evidence:**
| class_name | table_name | fixture @@map | match? |
|---|---|---|---|
| User | users | `@@map("users")` | yes |
| Post | posts | `@@map("posts")` | yes |
| Comment | comments | `@@map("comments")` | yes |

**Result: PASS** (same as iter-7 — unchanged)

---

## Assertion 3 — FLIPPED from iter-7 FAIL
> Every @relation(fields: [...], references: [...]) field produces a relationship in detected-entities.json with a non-empty target_entity that names another extracted model — no blank target_entity strings

**Evidence:**
All relationships in `detected-entities.json` now have populated `target_entity`:
- User → `{ "type": "one_to_many", "target_entity": "Post" }`
- Post → `{ "type": "many_to_one", "target_entity": "User" }`, `{ "type": "one_to_many", "target_entity": "Comment" }`
- Comment → `{ "type": "many_to_one", "target_entity": "Post" }`

**Iter-7 status:** ALL `target_entity` values were `""`. The prisma.yaml patterns had no capture groups;
the tail-based resolver could not extract model names that appear BEFORE the `@relation` marker.

**P1 fix:** New patterns with capture group `([A-Z]\\w*)` extract the TypeName directly from the matched
substring. The extractor prefers `relMatch[1]` when it starts with uppercase, bypassing the tail resolver.

**Result: PASS** (FLIPPED from iter-7 FAIL)

---

## Assertion 4 — FLIPPED from iter-7 FAIL
> One-to-many sides (posts Post[]) produce type one_to_many; their corresponding many-to-one inverse (author User @relation(...)) produces type many_to_one, both with correct target_entity

**Evidence:**
| Field | Entity | type | target_entity | Correct? |
|---|---|---|---|---|
| `posts Post[]` | User | one_to_many | Post | YES |
| `author User @relation(...)` | Post | many_to_one | User | YES |
| `comments Comment[]` | Post | one_to_many | Comment | YES |
| `post Post @relation(...)` | Comment | many_to_one | Post | YES |

**Iter-7 status:** `author User @relation(...)` had type `"relationship"` (generic fallback, not `many_to_one`).
`post Post @relation(...)` also had type `"relationship"`. Both had empty `target_entity`.

**P1 fix:** The new `many_to_one` pattern `\\b\\w+\\s+([A-Z]\\w*)\\s+@relation\\b` appears before any
generic `@relation` pattern and has `type: many_to_one`, so it wins for both `author` and `post` fields.

**Result: PASS** (FLIPPED from iter-7 FAIL)

---

## Assertion 5
> Generated database-mapping.md frontmatter has type='entity' and orm_profile='prisma'

**Evidence:**
```yaml
type: entity
orm_profile: prisma
```
Both fields present with correct values.

**Result: PASS** (same as iter-7 — unchanged)

---

## Assertion 6 — FLIPPED from iter-7 FAIL
> Mermaid erDiagram contains nodes named 'users', 'posts', 'comments' (the table names from @@map, not the model names) and at least one edge of cardinality ||--o{ linking users→posts AND another linking posts→comments

**Evidence:**
Generated Mermaid block:
```
erDiagram
    users ||--o{ posts : ""
    posts ||--o{ comments : ""
```
- Edge `users ||--o{ posts` — PRESENT
- Edge `posts ||--o{ comments` — PRESENT
- All nodes are real table names (`users`, `posts`, `comments`) from `@@map(...)`.

**Iter-7 status:** The Mermaid block had synthetic placeholder stubs as targets:
```
erDiagram
    users ||--o{ users_rel : ""
    posts ||--o{ posts_rel : ""
    comments ||--o{ comments_rel : ""
```
Because `target_entity` was empty, `output.ts` generated `<table_name>_rel` placeholders.
The required edges `users ||--o{ posts` and `posts ||--o{ comments` were absent.

**Fix chain:** A3 fix (populated `target_entity`) feeds directly into A6: `output.ts` resolves
the target entity's `table_name` (`Post → posts`, `Comment → comments`) when `target_entity` is
non-empty, producing real table-name nodes and edges.

**Result: PASS** (FLIPPED from iter-7 FAIL)

---

## Assertion 7
> mermaid_lint.js reports no issues on the generated page

**Evidence:**
Command: `node mermaid_lint.js --page /tmp/eval-i8-orm-prisma/database-mapping.md`
Output: `[]`

The lint passes:
1. `erDiagram` is a recognized diagram type.
2. `erDiagram` is in `_RELATIONSHIP_BRACKET_TYPES` so bracket-balance checking is skipped.
3. Edge syntax `users ||--o{ posts : ""` is structurally valid.

**Result: PASS** (same as iter-7 — unchanged)

---

## Summary

| # | Assertion (short) | Iter-7 | Iter-8 |
|---|---|---|---|
| 1 | 3 entities extracted | PASS | PASS |
| 2 | table_name matches @@map | PASS | PASS |
| 3 | non-empty target_entity on all @relation fields | FAIL | **PASS (FLIPPED)** |
| 4 | one_to_many / many_to_one classification correct with target_entity | FAIL | **PASS (FLIPPED)** |
| 5 | frontmatter type='entity', orm_profile='prisma' | PASS | PASS |
| 6 | Mermaid edges users→posts and posts→comments | FAIL | **PASS (FLIPPED)** |
| 7 | mermaid_lint reports no issues | PASS | PASS |

**Iter-7: 4/7 passing**
**Iter-8: 7/7 passing**

All 3 P1-targeted assertions (A3, A4, A6) flipped from FAIL to PASS.
