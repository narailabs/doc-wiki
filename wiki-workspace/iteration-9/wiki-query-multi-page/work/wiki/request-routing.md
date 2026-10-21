---
title: Request Routing
type: concept
created: 2026-04-01
updated: 2026-04-01
sources:
  - raw/request-routing.md
summary: Public traffic enters via nginx, which terminates TLS and routes by path prefix to internal services running in Kubernetes.
tags:
  - routing
  - nginx
  - kubernetes
  - load-balancer
quality: 0.6
---

# Request Routing

Public traffic enters through an nginx ingress controller. nginx terminates TLS and forwards to internal services by path prefix.

## Path prefixes

- `/auth/*` -> auth-service
- `/api/v1/orders/*` -> order-service
- `/api/v1/catalog/*` -> catalog-service

## Headers added by nginx

- `X-Forwarded-For`: originating IP
- `X-Real-IP`: client IP after proxying
