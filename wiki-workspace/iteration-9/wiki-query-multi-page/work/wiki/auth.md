---
title: Authentication
type: concept
created: 2026-04-01
updated: 2026-04-01
sources:
  - raw/auth.md
summary: Service authenticates clients with JWTs verified at the auth-service layer; tokens carry user_id and expire after 15 minutes.
tags:
  - authentication
  - jwt
  - access-token
  - rs256
quality: 0.6
---

# Authentication

Inbound requests carry a Bearer JWT in the `Authorization` header. The auth-service verifies the signature using its public RS256 key and extracts `user_id` and `roles` claims.

## Token format

JWTs are signed with RS256 and carry: `sub` (user_id), `iat`, `exp`, and `roles`.

## Validation flow

1. Reject if signature invalid
2. Reject if `exp` is past
3. Reject if `roles` does not include the route's required scope
