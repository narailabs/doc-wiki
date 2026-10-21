---
title: Database Write Path
type: concept
created: 2026-04-01
updated: 2026-04-01
sources:
  - raw/db-write-path.md
summary: Writes go to PostgreSQL primary via the pg connection pool; transactions wrap multi-row updates; deadlock retries are handled at the pool layer.
tags:
  - database
  - postgresql
  - write-path
  - connection-pool
quality: 0.6
---

# Database Write Path

Writes route to PostgreSQL primary through the `pg` connection pool. Each request opens a transaction (`BEGIN`), performs DML, and commits on success.

## Transaction shape

```text
BEGIN;
INSERT INTO orders (...) VALUES (...);
INSERT INTO order_items (...) VALUES (...);
COMMIT;
```

## Deadlock handling

The pool retries transient deadlock errors up to 3 times with exponential backoff.
