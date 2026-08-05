---
title: Request flow
tags: [api, auth, sequence]
status: draft
---

# Request flow

This page documents the authenticated API request flow from client through the
gateway, auth service, and database. The sequence diagram below is regenerated
by the `wiki-mermaid-agent` whenever the upstream service topology changes.

<!-- wiki-mermaid: start -->
%% Title: Authenticated API request flow
```mermaid
sequenceDiagram
    participant Client
    participant Gateway as API Gateway
    participant Auth as Auth Service
    participant DB as Database
    Client->>Gateway: POST /orders
    Gateway->>Auth: verify(token)
    Auth->>DB: SELECT user WHERE session_id=?
    DB-->>Auth: user row
    Auth-->>Gateway: user_id
    Gateway->>DB: INSERT INTO orders ...
    DB-->>Gateway: order_id
    Gateway-->>Client: 201 Created
```
<!-- wiki-mermaid: end -->

See the related pages on auth tokens and order persistence for more context.
