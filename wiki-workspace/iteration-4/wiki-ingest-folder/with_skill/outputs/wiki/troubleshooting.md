---
title: "Troubleshooting Guide"
page_type: reference
sources:
  - /tmp/eval-i4-ingest-folder/docs/troubleshooting.md
tags: ["error-budget", "latency-debugging", "jwks-rotation", "memory-pressure", "connection-leak"]
content_hash: "8c52fff1704d688f75e5b53eec1a7a0e510a7b3fed667fe000e44e795cf6df5a"
ingested_at: "2026-04-14T20:07:09.141Z"
---
# Troubleshooting Guide

# Troubleshooting Guide

This guide collects patterns and recipes for diagnosing common production issues. Always start by checking the service dashboard and recent deploys before drilling in.

## Elevated Error Rates

When a service's error budget is burning, the first check is whether a recent deploy coincides. Argo CD shows the deploy timestamp; if the burn starts within five minutes of a rollout, initiate a rollback immediately and investigate later.

If no recent deploy aligns, inspect the error breakdown by endpoint and by downstream dependency. An upstream dependency showing elevated latency is the most common cause — its error budget is also burning, and you can pivot to its dashboard for correlation.

## Latency Spikes

Latency spikes usually originate in one of three places: the database, a cold cache, or a degraded downstream. Query `pg_stat_statements` for queries exceeding 100 ms and check their plans. A plan change often means a missing index after a data-distribution shift.

Cold caches manifest as cache-hit-ratio dips. Restart rollouts are the usual culprit — every pod starts with an empty local cache, and the first few minutes of traffic hit the backend. Enabling cache pre-warming during rolling restarts mitigates this.

## Connection Exhaustion

PgBouncer client connection counts approaching the limit usually indicate a leak in a specific service. Correlate with the service's deploy history and running `pg_stat_activity` queries grouped by application name. A long-running transaction blocking others is a common pattern.

## Memory Pressure

Node memory pressure is detected by kubelet eviction events. Check `kubectl top pod` for the noisiest pod and review its recent changes. Java services with out-of-memory behavior usually need a heap dump at next occurrence; the diagnostic sidecar captures one automatically when eviction fires.

## Authentication Failures

Sudden auth failure spikes are almost always a JWKS rotation gone wrong. The JWKS must be published 24 hours before the old key is retired; if the gateway is still caching an old key that was retired, tokens signed with the new key will fail.

## Escalation

Any issue you cannot diagnose in 20 minutes deserves an escalation. Create an incident in PagerDuty, invite the appropriate service owner, and document findings in the incident channel as you go. Do not work alone beyond 30 minutes on a Sev 2 or higher.


## Related Pages

(populated by crosslink hook)
