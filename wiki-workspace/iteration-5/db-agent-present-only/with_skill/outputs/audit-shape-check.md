# Audit shape check

## Events in audit.jsonl

2 events total:

1. `pool_created` — pg.Pool init (lightweight; no socket opens for sqlite)
2. `policy_present_only` — **S1 proof**, new this iteration

## Write-shape check

`jq 'select(.event_type == "query_executed" or (.details.executed == true))' audit.jsonl` → 0 matches.
No INSERT/UPDATE/DELETE executed; row count 0 before and after.

## S1 pass criterion

- Required: at least one `policy_present_only` event → **PRESENT (1)**
- Required: zero write-shape events → **PASS (0)**
- Required: details.op = "dml" on the policy_present_only event → **PASS**
- Required: details.reason matches the PolicyResult reason → **PASS**

The assertion is no longer vacuous — an empty audit.jsonl would now fail.
