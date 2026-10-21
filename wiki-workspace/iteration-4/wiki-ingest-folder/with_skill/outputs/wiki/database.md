---
title: "Database Operations"
page_type: reference
sources:
  - /tmp/eval-i4-ingest-folder/docs/database.md
tags: ["postgresql", "replication", "migrations", "backups", "pgbouncer"]
content_hash: "88348d01496f0ba44938ed3b88e1601bb8cf3b34aa29a14f0997aff029a5a601"
ingested_at: "2026-04-14T20:07:09.140Z"
---
# Database Operations

# Database Operations

PostgreSQL is the system of record for all transactional data. Each service owns its own logical database; cross-service joins are prohibited to preserve bounded contexts.

## Cluster Topology

Each region runs a three-node PostgreSQL 15 cluster: one primary and two synchronous streaming replicas distributed across availability zones. Patroni manages leader election and failover; replication lag is continuously monitored and alerted when it exceeds one second.

## Connection Management

Applications connect via PgBouncer in transaction-pooling mode. Pool sizing is derived from per-service concurrency requirements, with a global cap to protect the primary. Long-running queries must declare a `statement_timeout` session parameter.

## Schema Management

Schema migrations are authored as SQL files and executed by a dedicated migration runner (Liquibase). Every migration carries a forward and backward script. Breaking changes require a multi-step rollout: ship the compatible schema change, deploy consuming services, then remove the old path.

## Backup and Recovery

Continuous WAL archiving streams to object storage every 60 seconds. Nightly base backups use `pg_basebackup` and are encrypted before upload. Point-in-time recovery is validated weekly by restoring a random backup into a sandbox cluster and running integrity checks.

The recovery time objective (RTO) is 30 minutes for any single cluster failure, and the recovery point objective (RPO) is under two minutes thanks to synchronous replication and WAL streaming.

## Performance

Query plans are reviewed as part of the migration process. Indexes are added only with evidence from production `pg_stat_statements`. Long-term storage of cold rows uses partitioning with automatic pruning via pg_partman.

Vacuum tuning is handled per-table: high-churn tables get autovacuum thresholds lowered to avoid bloat, while append-only tables are excluded from autovacuum entirely and managed by scheduled maintenance jobs.


## Related Pages

(populated by crosslink hook)
