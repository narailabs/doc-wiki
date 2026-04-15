# Timing

Wall time of the end-to-end CLI invocation against env `production`
(`postgresql://nonexistent.invalid.example:5432/prod`), running
`DROP TABLE users`:

- **wall (total):** **0.046 s**
- user: 0.03 s
- system: 0.01 s
- cpu utilisation: 89 %

Threshold per eval spec: < 0.5 s.  Observed: **~0.05 s → PASS (≈10× under budget).**

Raw `time` output (zsh builtin), as written to `time.txt`:

```
node  --env production --config ./wiki.config.yaml --sql "DROP TABLE users" >  0.03s user 0.01s system 89% cpu 0.046 total
```

## Why this is fast

The policy gate in `wiki_db/policy.ts` classifies `DROP TABLE users` as DDL
and returns `deny` *before* the query layer ever asks the pg driver to open
a connection. `pg.Pool` construction (the `pool_created` audit entry) is
synchronous and does not open a TCP socket, so there is no DNS lookup on
`nonexistent.invalid.example` and no SYN to port 5432. A real connection
attempt to a non-resolvable host would cost hundreds of ms (DNS timeout)
or at minimum one RTT before ECONNREFUSED; neither happens here.
