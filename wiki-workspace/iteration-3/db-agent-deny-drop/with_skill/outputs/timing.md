# End-to-end wall-time

Measured via `/usr/bin/time -p` on macOS (Darwin 25.2.0).

```
real 0.05
user 0.04
sys  0.01
```

- **Wall seconds**: **0.05 s (50 ms)**
- **Budget**: < 0.5 s
- **Result**: **PASS** — 10x under budget.

Self-reported `execution_time_ms` in the JSON payload: `0.14 ms` (measured from the start of `executeQuery` to the `deny` return, i.e. the policy-check cost in isolation). The rest of the 50 ms wall time is Node startup, dynamic imports of `wiki_db` / `mermaid_format` / js-yaml, driver registration, and YAML config parse.

## Interpretation

If the CLI had attempted DNS/TCP to `nonexistent.invalid.example`, we would see either:
- A DNS failure latency of ~1-5s and `ENOTFOUND nonexistent.invalid.example` on stderr, or
- A TCP connect timeout of 10s+ and `ETIMEDOUT`/`ECONNREFUSED` on stderr.

Neither is present. The 50 ms wall time corroborates that policy denied the query before the `pg` pool's async `pool.connect()` chain had time to initiate DNS.
