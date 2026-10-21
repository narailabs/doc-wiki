# relationships-check — F3 target_entity assertion

Source: extracted via `extractEntities(fileContents, jpaProfile)` against
`/Users/narayan/src/doc-wiki/agents/lib/wiki_orm/tests/fixtures/jpa/`.

## Enumerated relationships (3 total)

| # | Owner entity | Relationship type | `target_entity` | Empty? |
|---|---|---|---|---|
| 1 | Order | many_to_one   | `User`  | no |
| 2 | User  | one_to_many   | `Order` | no |
| 3 | User  | many_to_many  | `Role`  | no |

## Assertion

Every relationship has a non-empty `target_entity`. **0 / 3 empty.**

Result: **PASS**

## Raw JSON slice

```json
[
  { "owner": "Order", "type": "many_to_one",  "target_entity": "User" },
  { "owner": "User",  "type": "one_to_many",  "target_entity": "Order" },
  { "owner": "User",  "type": "many_to_many", "target_entity": "Role" }
]
```

The full extracted-entity dump (including `source_line` and `columns`) is in
`/tmp/eval-i3-orm-jpa-run/entities-full.json` (generated for this eval by
importing `extractEntities` directly, since `orm_detect.js --output-json`
only reports the relationship `type` list in its public contract).
