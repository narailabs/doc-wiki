---
title: "Client SDK Guide"
page_type: reference
sources:
  - /tmp/eval-i4-ingest-folder/docs/sdk.md
tags: ["client-sdk", "oauth-client", "retry-backoff", "pagination", "idempotency"]
content_hash: "6f3234e8b97374e8f7c52b4a71def15d59e63989bb91918d8e3a97ad9535b481"
ingested_at: "2026-04-14T20:07:09.141Z"
---
# Client SDK Guide

# Client SDK Guide

Client SDKs are the primary interface developers use to integrate with the platform. Three official SDKs are maintained: TypeScript, Go, and Python. Community SDKs exist for Ruby, PHP, and Rust but are unsupported.

## Installation

TypeScript: `npm install @platform/sdk`. Minimum Node version is 20. The package ships ES modules and CommonJS builds with type declarations.

Go: `go get github.com/platform/sdk/v3`. Requires Go 1.22 or later. The module provides context-aware APIs and respects the caller's deadline and cancellation signals.

Python: `pip install platform-sdk`. Requires Python 3.11 or later. Async and sync variants are both offered; internal transport uses `httpx`.

## Authentication

SDKs accept an API key or OAuth client credentials in the constructor. When both are provided, OAuth takes precedence. Token refresh is handled automatically — the SDK caches the access token and refreshes 5 minutes before expiry.

For server-to-server calls, SDKs support SPIFFE identity via the workload API. When the SPIFFE socket is available, the SDK prefers mTLS over API keys.

## Retries and Backoff

Every SDK implements the same retry policy: up to five attempts on retryable errors (HTTP 429 and 5xx except 501), with exponential backoff starting at 100 ms and a jitter factor of 50%. The `Retry-After` header is respected when present.

Idempotency keys are generated automatically for mutating requests unless the caller provides one. The generated key is the SHA256 of the request body plus a monotonically increasing nonce stored in a per-client counter.

## Pagination

List endpoints return opaque cursor tokens. SDKs expose both manual pagination (`nextPageToken`) and an iterator/async-iterator pattern that transparently walks all pages. The iterator is the recommended approach.

## Instrumentation

SDKs emit OpenTelemetry spans for every request with the standard attributes (http.method, http.status_code, net.peer.name). When a tracer is configured on the caller, spans are automatically linked to the caller's trace.


## Related Pages

(populated by crosslink hook)
