# Mermaid ER check — combined R2 + S2 + S4

## R2 (stub external targets) — holds

`role {` stub block at line 30 appears BEFORE the Role edges. No dangling reference.

## S2 (extended cardinality rendering) — IMPROVEMENT

Previously `users ||--o{ orders` was the only edge. Now:

- Line 33: `orders }o--|| users` (Order.many_to_one to User — **S2 new**)
- Line 34: `users ||--o{ orders` (User.one_to_many to Order — unchanged)

Both directions of the relationship are now visible, matching the entity-table mapping table above the Mermaid block.

## No phantom `_rel` suffixes

`grep _rel database-mapping.md` returns nothing. S2's CARDINALITY + target resolution (from R2) means every edge resolves to either a real extracted table or a declared stub.

## mermaid_lint

Returns `[]` — zero syntax issues.
