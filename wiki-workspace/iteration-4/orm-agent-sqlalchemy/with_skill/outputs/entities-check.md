# Entities Check — SQLAlchemy Fixture

Fixture: `/Users/narayan/src/doc-wiki/.claude/agents/lib/wiki_orm/tests/fixtures/sqlalchemy/models.py`

All three SQLAlchemy-declarative classes live in a **single file** (`models.py`).
Purpose: verify the extractor no longer collapses multiple classes per file (R3 fix).

## Extracted Classes

| # | class_name | __tablename__ (source) | Extracted table_name | columns | Match? |
|---|------------|------------------------|----------------------|---------|--------|
| 1 | `User`     | `"users"`              | `users`              | 3       | Yes    |
| 2 | `Order`    | `"orders"`             | `orders`             | 3       | Yes    |
| 3 | `Role`     | `"roles"`              | `roles`              | 2       | Yes    |

## Verification Against Source

```python
class User(Base):
    __tablename__ = "users"
    id, username, email                   # 3 cols  -> extracted columns=3  OK

class Order(Base):
    __tablename__ = "orders"
    id, total_amount, user_id             # 3 cols  -> extracted columns=3  OK

class Role(Base):
    __tablename__ = "roles"
    id, name                              # 2 cols  -> extracted columns=2  OK
```

## R3 Fix Verification: Multi-Class Per File

- Source file count: **1** (`models.py`)
- Classes defined in that file: **3** (`User`, `Order`, `Role`)
- Entities emitted in `detected-entities.json`: **3** (`User`, `Order`, `Role`)
- Each class has its own distinct `__tablename__` preserved: **yes**
- No collapsing / no duplication / no last-class-wins behavior observed.

**Result: R3 fix works correctly. Multi-class-per-file extraction preserves all classes with correct per-class table_name values.**

The top-level `user_roles = Table(...)` association table is (correctly) not emitted as an entity — it's an M2M link table, not a declarative class, and the profile treats it as relationship metadata rather than an entity.
