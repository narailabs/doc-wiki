---
title: Session Store
type: concept
tags: [session, redis, cache, storage]
sources: [raw/session.md]
created: 2026-04-25
updated: 2026-04-25
summary: Redis-backed cache that fronts the users table for fast session lookups.
---

# Session Store

A Redis-backed write-through cache that maps session IDs to user IDs in the
users table.
