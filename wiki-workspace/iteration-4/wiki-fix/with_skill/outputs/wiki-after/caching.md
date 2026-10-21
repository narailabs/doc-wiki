---
title: Caching
type: concept
tags: [cache, redis]
sources: [internal-docs]
created: 2026-04-10
updated: 2026-04-10
summary: Redis cluster stores session and rate-limit state with a 24-hour TTL.
quality: 0.8
---

# Caching

## Overview

A three-node Redis cluster backs session caching and short-lived rate-limit
counters. Clients talk to Redis through the in-house cache client library which
adds circuit-breaking and retry policy.

## Eviction

Keys use a `volatile-lru` policy. Sessions carry explicit TTLs; rate-limit
counters are set with one-minute expiry.

## Related pages

- [Authentication](authentication.md)
- [Database](database.md)
