---
title: Authentication
type: concept
tags: [auth, jwt, security]
sources: [internal-docs]
created: 2026-04-10
updated: 2026-04-10
summary: Service uses HS256 signing for JWT access tokens issued by the auth gateway.
quality: 0.85
---

# Authentication

## Overview

The authentication service issues JWT access tokens to API clients. Each token is
signed with HS256 and has a 60-minute TTL. The signing secret is rotated weekly
and delivered to service pods through the platform secrets manager.

## Token verification

Downstream services verify tokens using the shared HS256 secret. Because the
signing and verification keys are the same, all services that accept these
tokens must have read access to the secret. The public verifier endpoint exposes
a `/jwks` stub for compatibility but does not currently publish asymmetric keys.

## Related pages

- [Database](database.md)
- [Caching](caching.md)
