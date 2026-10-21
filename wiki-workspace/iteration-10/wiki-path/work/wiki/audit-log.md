---
title: Audit Log
type: concept
tags: [audit, logging, compliance, postgres]
sources: [raw/audit.md]
created: 2026-04-25
updated: 2026-04-25
summary: Append-only audit log table — records every authentication event for compliance review.
---

# Audit Log

Every authentication event writes a row into the audit_log table. The audit log
itself is part of the database schema.
