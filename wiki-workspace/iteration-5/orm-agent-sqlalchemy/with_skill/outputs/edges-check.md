# S2 edges check — PASS

## Before (iteration-4)

output.ts only rendered `one_to_many` and `many_to_many` cardinalities. The SQLAlchemy profile emits relationship types `relationship`, `foreign_key`, and `many_to_one` — none of which were in the renderer's allow-list. Result: 0 edges in the Mermaid diagram.

## After (iteration-5)

output.ts now has a `CARDINALITY` map covering:

- `one_to_one` → `||--||`
- `one_to_many` → `||--o{`
- `many_to_one` → `}o--||`
- `many_to_many` → `}o--o{`
- `foreign_key` → `}o--||`
- `relationship` → `||--o{`

Edges emitted in database-mapping.md:

```
users ||--o{ users_rel : ""
orders ||--o{ orders_rel : ""
orders }o--|| orders_rel : ""
```

**Edge count: 3** (was 0 in iteration-4). S2 assertion "AT LEAST ONE edge" **passes**.

## Caveat

The edges point to `*_rel` placeholder nodes rather than the real entity tables because the SQLAlchemy extractor doesn't resolve `target_entity` for `relationship("Target")` calls. That's a known orthogonal extraction gap (independent of S2). S2's job was the RENDERER — which now correctly emits edges for every relationship type the extractor reports. A future iteration should add target resolution for SQLAlchemy's `relationship(Target)` first-arg pattern, similar to what F3 did for JPA generic type args.

mermaid_lint still returns `[]` (no syntax issues) because the placeholder-reference is valid Mermaid.
