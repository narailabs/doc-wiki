---
title: Audit Log
type: concept
created: 2026-04-01
updated: 2026-04-01
sources:
  - raw/audit-log.md
summary: Every successful write is mirrored to the audit_log table with actor, action, and entity-id; the audit row is written within the same transaction as the primary write.
tags:
  - audit-log
  - compliance
  - postgresql
  - audit-trail
quality: 0.6
---

# Audit Log

Every state-changing request emits a row into the `audit_log` table. The row is INSERT'd inside the same transaction as the primary write, so audit and data either both commit or both roll back.

## audit_log columns

- `id` (UUID)
- `actor_user_id` (FK to users)
- `action` (enum: 'create', 'update', 'delete')
- `entity_type` (e.g. 'order')
- `entity_id`
- `ts` (timestamp)
