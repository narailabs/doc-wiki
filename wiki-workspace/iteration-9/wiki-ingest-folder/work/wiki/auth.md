---
title: Auth
type: concept
created: 2026-05-03
updated: 2026-05-03
sources:
  - raw/auth.md
summary: JWT-based authentication; refresh tokens persist for 30 days in the sessions table.
tags:
  - authentication
  - jwt
  - session
  - refresh-token
---

# Auth

Authentication uses JWT tokens minted by the auth service. Refresh tokens live in the sessions table for 30 days.
