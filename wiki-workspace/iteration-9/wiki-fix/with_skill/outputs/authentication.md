---
title: Authentication
type: concept
created: 2026-04-15
updated: 2026-05-03
sources:
  - raw/authentication.md
summary: Service-side authentication using JWTs signed with RS256 and stateless sessions.
tags:
  - authentication
  - jwt
  - rs256
  - signing
  - sessions
quality: 0.7
---

# Authentication

The service issues JWT access tokens signed with RS256 using a single shared secret loaded from `JWT_SECRET`. The signing key is rotated quarterly out of band.

## Token validation

Every request validates the JWT signature using RS256. Reject tokens whose signature does not match.

## Operational notes

The RS256 secret rotation is the riskiest part of the auth flow because tokens minted under the old secret immediately fail validation under the new one.
