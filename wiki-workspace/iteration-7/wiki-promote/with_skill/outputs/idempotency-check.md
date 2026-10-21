# Idempotency Check

## Second-Run Behavior

When promote is re-run for the same archive (`outputs/queries/2026-04-14-how-does-authentication-work.md`) targeting the same destination (`wiki/auth/authentication-flow.md`):

```
WARNING: Page already exists at wiki/auth/authentication-flow.md — promote is a no-op.
Skipping page creation, edges append, and event logging.
Second-run result: PAGE_EXISTS_NOOP
```

## Evidence: No Duplicates Created

| Metric | Before 2nd run | After 2nd run | Delta |
|--------|---------------|---------------|-------|
| events.jsonl lines | 2 | 2 | 0 |
| edges.jsonl lines | 1 | 1 | 0 |

- The `log/events.jsonl` remains at exactly 2 lines (1 init + 1 promote — no duplicate promote event)
- The `graph/edges.jsonl` remains at exactly 1 line (no duplicate edge)
- The `wiki/auth/authentication-flow.md` file was not overwritten

## Conclusion

PASS — Re-running promote for an already-promoted archive is a no-op. No page duplication, no duplicate events, no duplicate edges.
