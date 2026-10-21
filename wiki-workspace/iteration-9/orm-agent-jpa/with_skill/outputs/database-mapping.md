---
title: Database Mapping — demo
type: entity
tags: [database, orm, jpa]
generated_by: orm-mapper
orm_profile: jpa
created: 2026-05-03
updated: 2026-05-03
summary: "Auto-generated database mapping for demo using jpa ORM profile."
---

## Entity-Table Mapping

| Entity Class | Schema.Table | Columns | Relationships |
|---|---|---|---|
| Order | orders | 3 | many_to_one |
| User | public.users | 3 | one_to_many |

## Entity Relationship Diagram

```mermaid
erDiagram
    orders {
        string id
        string total_cents
        string placed_at
    }
    users {
        string id
        string email
        string full_name
    }
    users ||--o{ orders : ""
```

## How to Go Deeper

This page was compiled from ORM source files. Use these commands to verify or update the information against the live database:

- **Order** (`orders`)
  - Columns: `wiki agent db-query dev "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'orders'"`
  - Sample rows: `wiki agent db-query dev "SELECT * FROM orders LIMIT 5"`
- **User** (`public.users`)
  - Columns: `wiki agent db-query dev "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'users'"`
  - Sample rows: `wiki agent db-query dev "SELECT * FROM public.users LIMIT 5"`
- **Live code:** Read `wiki-workspace/iteration-9/orm-agent-jpa/work/src/main/java/com/example/demo/Order.java`, `wiki-workspace/iteration-9/orm-agent-jpa/work/src/main/java/com/example/demo/User.java` — ORM source files this mapping was extracted from.
