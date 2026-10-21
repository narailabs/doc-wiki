---
title: Database Mapping — sqlalchemy-demo
type: entity
tags: [database, orm, sqlalchemy]
generated_by: orm-mapper
orm_profile: sqlalchemy
created: 2026-05-03
updated: 2026-05-03
summary: "Auto-generated database mapping for sqlalchemy-demo using sqlalchemy ORM profile."
---

## Entity-Table Mapping

| Entity Class | Schema.Table | Columns | Relationships |
|---|---|---|---|
| User | users | 3 | relationship, relationship |
| Order | orders | 4 | relationship, relationship, foreign_key |
| OrderItem | order_items | 4 | relationship, foreign_key |
| Profile | profiles | 3 | relationship, foreign_key |

## Entity Relationship Diagram

```mermaid
erDiagram
    users {
        string id
        string email
        string full_name
    }
    orders {
        string id
        string user_id
        string total_cents
        string placed_at
    }
    order_items {
        string id
        string order_id
        string sku
        string quantity
    }
    profiles {
        string id
        string user_id
        string bio
    }
    orders {
        string _external "not-in-scan"
    }
    users {
        string _external "not-in-scan"
    }
    users ||--o{ orders : ""
    users ||--o{ profiles : ""
    orders ||--o{ order_items : ""
```

## How to Go Deeper

This page was compiled from ORM source files. Use these commands to verify or update the information against the live database:

- **User** (`users`)
  - Columns: `wiki agent db-query dev "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'users'"`
  - Sample rows: `wiki agent db-query dev "SELECT * FROM users LIMIT 5"`
- **Order** (`orders`)
  - Columns: `wiki agent db-query dev "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'orders'"`
  - Sample rows: `wiki agent db-query dev "SELECT * FROM orders LIMIT 5"`
- **OrderItem** (`order_items`)
  - Columns: `wiki agent db-query dev "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'order_items'"`
  - Sample rows: `wiki agent db-query dev "SELECT * FROM order_items LIMIT 5"`
- **Profile** (`profiles`)
  - Columns: `wiki agent db-query dev "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'profiles'"`
  - Sample rows: `wiki agent db-query dev "SELECT * FROM profiles LIMIT 5"`
- **Live code:** Read `/Users/narayan/src/doc-wiki/wiki-workspace/iteration-9/orm-agent-sqlalchemy/work/models.py` — ORM source files this mapping was extracted from.
