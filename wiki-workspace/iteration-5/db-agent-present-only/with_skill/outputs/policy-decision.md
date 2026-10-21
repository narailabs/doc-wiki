# Policy decision

**Gate:** PRESENT_ONLY
**Rule:** DML classifier — `Policy.checkQuery` DML branch at `policy.ts:223-251` matches on `_DML_KEYWORDS` (INSERT).
**Decision:** formatted SQL returned, not executed.

## S1 — symmetric audit event now recorded

With the S1 fix, `Policy.checkQuery`'s PRESENT_ONLY branch now calls `_emitPresentOnly` (symmetric to `_emitDeny`). The event lands in audit.jsonl with:

- `event_type: policy_present_only`
- `details.reason: "DML statements are displayed but not executed"`
- `details.op: "dml"`
- `details.formatted_sql: "INSERT INTO users (name, email) VALUES ('Test', 'test@example.com')"`

Previously (iter-4) this path emitted zero policy-gate audit events — the "no write event" assertion passed vacuously. It now passes because the presence of `policy_present_only` is asserted alongside the absence of write-shape events.
