# Relationships check

From detected-entities.json, jq filter for blank target_entity returns 0 entries.

Relationships rendered as Mermaid edges (database-mapping.md lines 33-34):

- `orders }o--|| users` — Order.many_to_one(User) [S2 fix: many_to_one now renders as `}o--||`]
- `users ||--o{ orders` — User.one_to_many(Order)

Plus: `role { _external }` stub block at line 30 (R2 holds) for the @ManyToMany to Role (Role.java not in fixture).
