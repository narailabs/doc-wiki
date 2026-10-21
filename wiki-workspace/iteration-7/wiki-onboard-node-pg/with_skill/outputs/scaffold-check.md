# Scaffold Check — /tmp/eval-i7-onboard-node-pg

All required top-level directories confirmed present after `init_wiki.js` ran.

## Root listing

```
drwxr-xr-x  audit/
drwxr-xr-x  graph/
drwxr-xr-x  log/
drwxr-xr-x  outputs/
drwxr-xr-x  raw/
drwxr-xr-x  wiki/
-rw-r--r--  wiki.config.yaml
-rw-r--r--  .wiki-ignore
drwxr-xr-x  .wiki-cache/
```

## wiki/ contents
```
wiki/claims/          (dir)
wiki/synthesis/       (dir)
wiki/templates/       (dir)
wiki/index.md         (27 bytes)
wiki/summaries.md     (50 bytes)
wiki/overview.md      (46 bytes)
```

## raw/ contents
```
raw/                  (empty — no ingests yet)
```

## graph/ contents
```
graph/edges.jsonl     (0 bytes — no edges yet)
```

## audit/ contents
```
audit/open/           (dir)
audit/resolved/       (dir)
```

## log/ contents
```
log/daily/                    (dir)
log/detection-trace.jsonl     (2042 bytes)
log/events.jsonl              (1090 bytes — 2 events: init + onboard)
```

## outputs/ contents
```
outputs/queries/      (dir)
outputs/reports/      (dir)
```

## Assessment

| Directory | Present? |
|-----------|----------|
| wiki/     | YES      |
| raw/      | YES      |
| graph/    | YES      |
| audit/    | YES      |
| log/      | YES      |
| outputs/  | YES      |

All 6 required scaffold directories confirmed. Auto-init triggered during onboard since scaffold did not exist before.
