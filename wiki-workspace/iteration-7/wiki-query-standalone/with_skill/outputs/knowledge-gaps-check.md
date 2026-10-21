# Knowledge Gaps Check

## Extracted `## Knowledge gaps` Section from answer.md

---

## Knowledge gaps

The source pages do not cover the following aspects of the request lifecycle:

1. **Request-ID propagation** — none of the five pages describe how a correlation or trace ID is generated at the nginx or app-server boundary, whether it is attached to the JWT claims or a separate header, or how it flows through to the `audit_log` row. It is unclear whether request IDs exist in this system at all, and if so, which component is responsible for generating and propagating them across service boundaries.

2. **Error-path rollback behavior** — the DB write path shows the `ROLLBACK` call in the catch block, but no page explains what happens upstream when a rollback occurs: whether the app-server returns a specific error schema to the client, whether the failed write is retried, or how partial failures (e.g., main row succeeds but audit row fails) are handled. The observable behavior on the client side after a failed transaction is not documented.

---

## Assertion Verification

| Gap | Present | Notes |
|-----|:-------:|-------|
| Request-ID propagation | YES | Item 1 explicitly names "Request-ID propagation" and explains it is absent from all 5 source pages |
| Error-path rollback | YES | Item 2 explicitly names "Error-path rollback behavior" and identifies it as not documented |

Both intentionally-omitted gaps surface correctly. The section header is `## Knowledge gaps` (exact match to assertion requirement).
