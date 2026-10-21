---
title: Caching
type: concept
created: 2026-05-03
updated: 2026-05-03
sources:
  - raw/caching.md
summary: Redis 7 fronts Postgres for hot keys; user-bound entries TTL 60s, static catalog data TTL 5 minutes.
tags:
  - caching
  - redis
  - ttl
  - performance
---

# Caching

Redis 7 sits in front of Postgres for hot keys. TTLs default to 60s for user-bound entries and 5 minutes for static catalog data.
