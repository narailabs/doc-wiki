# Relationships Check — orm-agent-prisma (iter-8)

Source: `detected-entities.json`

## Iter-8 Results

| Entity | Fixture line | type | target_entity |
|---|---|---|---|
| User | `posts Post[]` | one_to_many | Post |
| Post | `author User @relation(...)` | many_to_one | User |
| Post | `comments Comment[]` | one_to_many | Comment |
| Comment | `post Post @relation(...)` | many_to_one | Post |

## Comparison to Iter-7

| Entity | Fixture line | iter-7 type | iter-7 target_entity | iter-8 type | iter-8 target_entity |
|---|---|---|---|---|---|
| User | `posts Post[]` | one_to_many | **(empty)** | one_to_many | **Post** |
| Post | `author User @relation(...)` | relationship | **(empty)** | **many_to_one** | **User** |
| Post | `comments Comment[]` | one_to_many | **(empty)** | one_to_many | **Comment** |
| Comment | `post Post @relation(...)` | relationship | **(empty)** | **many_to_one** | **Post** |

### What changed

- **target_entity**: All 4 relationships had empty `target_entity` in iter-7. All 4 are now populated.
- **type for @relation fields**: `Post.author` and `Comment.post` were typed `"relationship"` (generic fallback) in iter-7; they are now correctly typed `"many_to_one"`.
- **type for [] fields**: `User.posts` and `Post.comments` were already `one_to_many` in iter-7 and remain correct.

### Root cause of iter-7 failure (now resolved)

In iter-7, `prisma.yaml` had no capture groups in its relationship patterns. The extractor's
tail-based `_resolveRelationshipTarget()` saw the text *after* `@relation` (the argument list
`(fields: [...], references: [...])`) and `[]` (nothing useful), and could not extract the
adjacent TypeName that appears *before* those markers in Prisma syntax.

The P1 fix added capture groups to both patterns:
- `\\b\\w+\\s+([A-Z]\\w*)\\s+@relation\\b` — captures `User` from `author User @relation(...)`
- `\\b\\w+\\s+([A-Z]\\w*)\\[\\]` — captures `Post` from `posts Post[]`

The extractor now prefers `relMatch[1]` when it starts with uppercase, bypassing the tail resolver.
