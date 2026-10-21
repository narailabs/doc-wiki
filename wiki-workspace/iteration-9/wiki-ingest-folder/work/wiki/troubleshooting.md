---
title: Troubleshooting
type: concept
created: 2026-05-03
updated: 2026-05-03
sources:
  - raw/troubleshooting.md
summary: Common 502 path: check gateway pod first; DB-timeout symptoms point to Postgres connection-pool saturation.
tags:
  - troubleshooting
  - debugging
  - operations
  - error-handling
---

# Troubleshooting

If you see 502 errors, check the gateway pod first; if logs show DB timeouts, look at the Postgres connection pool saturation gauge in Grafana.
