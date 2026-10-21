---
title: Schema
type: entity
---
# Schema overview
Preamble that should not be touched.
<!-- wiki-mermaid: start -->
(empty)
<!-- wiki-mermaid: end -->
Trailing paragraph that should also not be touched.

## Diagrams

%% Title: User / Order / Product schema
```mermaid
erDiagram
    User ||--o{ Order : places
    Order }o--o{ Product : contains
    User {
        int id PK
        string email
    }
    Order {
        int id PK
        int user_id FK
        decimal total
    }
    Product {
        int id PK
        string name
    }
```
