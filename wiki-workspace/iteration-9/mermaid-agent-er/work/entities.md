# Domain Entities

This page documents the core domain entities for the order-processing system.
The relationships below were extracted from the ORM models and reviewed by the
data team in Q1.

## Background

The schema is intentionally normalized: customer accounts (`User`) place orders
(`Order`), and each order carries one or more product line items (`Product`).

## Schema

<!-- wiki-mermaid: start -->
%% Title: Order Processing Schema
```mermaid
erDiagram
    User ||--o{ Order : places
    Order ||--o{ Product : contains
    User {
        int id PK
        string email
        string name
    }
    Order {
        int id PK
        int user_id FK
        decimal total
        datetime placed_at
    }
    Product {
        int id PK
        int order_id FK
        string sku
        decimal price
    }
```
<!-- wiki-mermaid: end -->

## Notes

- Cardinalities reflect the live production schema as of 2026-05-01.
- The ER diagram above is auto-generated; do not edit it manually.
