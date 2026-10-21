# ORM Profile Check

## orm_detect.js output

File: `orm-detection.json`

```json
{
  "status": "success",
  "orm_detected": null,
  "entities": [],
  "mapping_file": null,
  "mermaid": null
}
```

## wiki.config.yaml orm section

```yaml
orm:
  enabled: true
  profiles: []
  custom_profiles: []
  cross_validate_against_db: true
```

## Analysis

The fixture project has:
- `pg` v8.11.0 — raw PostgreSQL driver (NOT an ORM)
- `express` v4.18.0 — HTTP framework (NOT an ORM)
- `dotenv` v16.3.0 — environment config (NOT an ORM)
- `src/models/user.js` — plain JS object literal `{ id: null, name: '', email: '' }` (NOT a model class, NOT an ORM entity)

### ORM profiles checked by orm_detect.js (auto mode)

| Profile | Marker | Found? |
|---------|--------|--------|
| jpa | `@Entity`, `@Table` annotations in .java/.kt | NO |
| sqlalchemy | `declarative_base()`, `mapped_column` in .py | NO |
| django | `models.Model` subclass in models.py | NO |
| prisma | `schema.prisma` with `model` definitions | NO |
| typeorm | `@Entity()`, `@Column()` decorators in .ts | NO |
| entity_framework | `DbContext` subclass in .cs | NO |
| activerecord | `ApplicationRecord` / `ActiveRecord::Base` in .rb | NO |

### Result

`orm_detected: null` — no ORM profile matched.

`ecosystem.orm.profiles: []` — empty list, which is correct.

## Verdict

PASS — profiles is `[]`, which satisfies assertion 5. None of the named ORM profiles
(jpa, sqlalchemy, django, prisma, typeorm, activerecord, entity_framework) appear.
