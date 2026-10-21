---
title: App Server
type: concept
created: 2026-04-01
updated: 2026-04-01
sources:
  - raw/app-server.md
summary: Each microservice runs as a stateless Node.js process listening on port 3000; horizontal scaling via Kubernetes deployments.
tags:
  - app-server
  - nodejs
  - stateless
  - microservice
quality: 0.6
---

# App Server

Each microservice is a Node.js process. Services are stateless and scale horizontally via Kubernetes deployments.

## Lifecycle

1. Process starts and reads config from env vars
2. Connects to PostgreSQL via the pg connection pool (max 10 connections per pod)
3. Listens on port 3000 for requests proxied from nginx
4. Validates JWT via auth-service (or local public key)
5. Dispatches request to handler
