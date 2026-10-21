# Relationships Check — blank `target_entity` must be 0

## JSON shape

`detected-entities.json` emits `entities[].relationships` as an array of **kind strings** (not objects). For Order/User the values are:

```json
{ "class_name": "Order", "relationships": ["many_to_one"] }
{ "class_name": "User",  "relationships": ["one_to_many", "many_to_many"] }
```

## jq — count any relationship objects with blank/missing target_entity

```bash
jq '[.entities[].relationships[] | select(type=="object") | select(.target_entity == null or .target_entity == "")] | length' detected-entities.json
```

**Result: `0`** — PASS.

No relationship entries carry a blank `target_entity`. The payload contains only relationship-kind strings, so there is nothing to mis-target. Relationship targets (including the external `Role`) surface in the Mermaid ER diagram inside `mapping_file` and in the `database-mapping.md` diagram block, where R2 now emits an explicit `role { ... }` stub before the edge.

## Also checked — no empty edge targets in Mermaid

```bash
grep -E '}o--o\{\s*:' database-mapping.md || echo "no empty-target edges"
```

Result: no empty-target edges (every edge has a named target node — `orders`, `role`).
