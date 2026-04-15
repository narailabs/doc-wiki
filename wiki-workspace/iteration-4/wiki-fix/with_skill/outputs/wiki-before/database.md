---
title: Database
type: concept
tags: [database, postgres]
sources: [internal-docs]
created: 2026-04-10
updated: 2026-04-10
summary: Primary PostgreSQL cluster stores user, billing, and session tables.
quality: 0.8
---

# Database

## Overview

The primary data store is a PostgreSQL 15 cluster running in the production VPC.
Tables include `users`, `billing_accounts`, and `sessions`. Schema migrations are
managed through an in-house migration runner and reviewed in pull requests.

## Replication

A single async read replica serves analytical queries. Failover is manual and
documented in the runbook.

## Related pages

- [Authentication](authentication.md)
- [Caching](caching.md)
