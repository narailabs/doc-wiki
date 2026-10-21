# Relationships Check

## Assertion: target_entity non-empty; type classification correct

From `detected-entities.json`:

### User entity relationships
```json
[
  { "type": "one_to_many", "target_entity": "" }
]
```
- Source: `posts Post[]` — one_to_many type is CORRECT
- `target_entity`: "" — FAIL (should be "Post" or "posts")

### Post entity relationships
```json
[
  { "type": "relationship", "target_entity": "" },
  { "type": "one_to_many",  "target_entity": "" }
]
```
- `author User @relation(...)` → type "relationship" — FAIL (should be "many_to_one")
- `comments Comment[]` → type "one_to_many" — CORRECT
- `target_entity`: "" for both — FAIL

### Comment entity relationships
```json
[
  { "type": "relationship", "target_entity": "" }
]
```
- `post Post @relation(...)` → type "relationship" — FAIL (should be "many_to_one")
- `target_entity`: "" — FAIL

## Root cause

The prisma.yaml `relationship_detection.patterns` uses:
- `{ pattern: "@relation", type: relationship }` — does NOT resolve to a target entity
- `{ pattern: "\\[\\]", type: one_to_many }` — does NOT capture the referenced model name

The extractor does not parse the referenced model name from `Post[]` or `User @relation(...)`.
The `target_entity` field is empty for ALL relationships.

## Verdict

- **Non-empty target_entity**: FAIL — all `target_entity` values are `""`
- **one_to_many classification for `posts Post[]`**: PASS (User entity has one_to_many)
- **many_to_one classification for `author User @relation(...)`**: FAIL — type is "relationship" not "many_to_one"
- **one_to_many for `comments Comment[]`**: PASS (Post entity has one_to_many)
- **many_to_one for `post Post @relation(...)`**: FAIL — type is "relationship" not "many_to_one"
