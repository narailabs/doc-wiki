# Relationships Check — SQLAlchemy Fixture

## Source-Level Relationships (ground truth from `models.py`)

| From     | To     | Kind            | Mechanism                                   |
|----------|--------|-----------------|---------------------------------------------|
| `User`   | `Order`| one-to-many     | `orders = relationship("Order", back_populates="user")` |
| `Order`  | `User` | many-to-one     | `user = relationship("User", back_populates="orders")`  |
| `Order`  | `User` | FK column       | `user_id = Column(Integer, ForeignKey("users.id"))`      |
| `User`   | `Role` | many-to-many    | `roles = relationship("Role", secondary=user_roles)`     |
| `users`  | `roles`| M2M assoc table | top-level `user_roles = Table(...)` with two FKs         |

## Extracted Relationships (from `detected-entities.json`)

| Entity  | relationships array           | Count |
|---------|-------------------------------|-------|
| `User`  | `["relationship","relationship"]` | 2 |
| `Order` | `["relationship","foreign_key"]`  | 2 |
| `Role`  | `[]`                              | 0 |

## Interpretation

- **User (2):** both `relationship()` calls captured — the `orders` O2M and the `roles` M2M via `secondary=user_roles`.
- **Order (2):** the `user` `relationship()` call plus the `ForeignKey("users.id")` on `user_id` are both captured.
- **Role (0):** `Role` itself declares no `relationship()` (the M2M is defined on the `User` side only, which is an authentic reflection of the SQLAlchemy source). Expected.

## Tallies

- Total `relationship()` calls in source: 3 (`User.orders`, `User.roles`, `Order.user`) -> extracted: 3 (counted as `"relationship"` entries).
- Total `ForeignKey(...)` Column constraints in source: 3 (`Order.user_id`, plus two inside the `user_roles` `Table(...)`). On declarative classes only: 1 (`Order.user_id`) -> extracted: 1 (`"foreign_key"` on `Order`).
- No relationships were misattributed to the wrong class.
- No ambiguous / missing relationships from the ground-truth declarative models.

**Result: Relationship extraction is accurate for all three declarative classes. The M2M association table `user_roles` is correctly treated as metadata rather than a class-level relationship.**
