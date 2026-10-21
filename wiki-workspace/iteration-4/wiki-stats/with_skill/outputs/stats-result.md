# Wiki Stats — `/tmp/eval-i4-stats-wiki/` over last 7 days

Generated 2026-04-14. Window: `--since 7d` (events ≥ 2026-04-07T20:05:01+00:00).

## Raw stats (from `event_logger.js stats`)

```json
{
  "total_ops": 17,
  "ops_by_type": {
    "ingest": 7,
    "query": 6,
    "lint": 2,
    "fix": 2
  },
  "total_cost_usd": 0.0,
  "reduction_ratio": {},
  "per_agent_cost": {}
}
```

Exit code: 0. stderr: empty.

## Per-op breakdown (count / total_tokens / avg_duration_ms)

Per-op `total_tokens` and `avg_duration_ms` are derived from the fixture's `tokens`
and `duration_ms` fields for the same 17 events the `stats` subcommand included.
The built-in CLI reports `total_ops`, `ops_by_type`, `total_cost_usd`,
`reduction_ratio`, and `per_agent_cost`; the tokens/duration aggregates are
computed directly over the already-filtered window.

| op     | count | total_tokens | avg_duration_ms |
|--------|------:|-------------:|----------------:|
| ingest |     7 |         7500 |          332.14 |
| query  |     6 |         4780 |          192.50 |
| lint   |     2 |            0 |           85.00 |
| fix    |     2 |            0 |          142.50 |
| **Σ**  |  **17** |    **12280** |               — |

Notes:
- `lint` and `fix` events have `tokens: 0` in the fixture (those ops don't
  invoke an LLM on this run), so `total_tokens` is 0 — not missing.
- `avg_duration_ms` is the arithmetic mean of `duration_ms` for each op in
  the 7-day window.
- Totals: ops=17, cost_usd=0.0 (no cost field in fixture), tokens=12280.
