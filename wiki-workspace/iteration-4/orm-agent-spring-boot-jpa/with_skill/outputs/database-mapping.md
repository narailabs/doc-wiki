---
title: Database Mapping — jpa
type: entity
tags: [database, orm, jpa]
generated_by: orm-mapper
orm_profile: jpa
created: 2026-04-14
updated: 2026-04-14
summary: "Auto-generated database mapping for jpa using jpa ORM profile."
---

## Entity-Table Mapping

| Entity Class | Schema.Table | Columns | Relationships |
|---|---|---|---|
| Order | orders | 1 | many_to_one |
| User | public.users | 2 | one_to_many, many_to_many |

## Entity Relationship Diagram

```mermaid
erDiagram
    orders {
        string total_amount
    }
    users {
        string username
        string email
    }
    role {
        string _external "not-in-scan"
    }
    users ||--o{ orders : ""
    users }o--o{ role : ""
```

## How to Go Deeper

This page was compiled from ORM source files. Use these commands to verify or update the information against the live database:

- **Order** (`orders`)
  - Columns: `wiki agent db-query dev "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'orders'"`
  - Sample rows: `wiki agent db-query dev "SELECT * FROM orders LIMIT 5"`
- **User** (`public.users`)
  - Columns: `wiki agent db-query dev "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'users'"`
  - Sample rows: `wiki agent db-query dev "SELECT * FROM public.users LIMIT 5"`
- **Live code:** Read `/Users/narayan/src/doc-wiki/agents/lib/wiki_orm/tests/fixtures/jpa/Order.java`, `/Users/narayan/src/doc-wiki/agents/lib/wiki_orm/tests/fixtures/jpa/User.java` — ORM source files this mapping was extracted from.
