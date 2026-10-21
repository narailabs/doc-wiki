# Parent-link check

Each submodule `CLAUDE.md` must contain a relative markdown link back to
the root `CLAUDE.md`. The generator emits this under a `## Parent Project`
section with a link of the form `[Root CLAUDE.md](../../CLAUDE.md)` for
2-segment submodule paths like `services/<name>`.

Command:

```bash
grep -n 'CLAUDE.md' <file> | grep '\.\.'
```

## Results

### services/api/CLAUDE.md

```
10:- [Root CLAUDE.md](../../CLAUDE.md)
```

PASS — relative link `../../CLAUDE.md` resolves from
`/tmp/eval-claude-md-gen/services/api/` back to
`/tmp/eval-claude-md-gen/CLAUDE.md`.

### services/worker/CLAUDE.md

```
10:- [Root CLAUDE.md](../../CLAUDE.md)
```

PASS — relative link `../../CLAUDE.md` resolves from
`/tmp/eval-claude-md-gen/services/worker/` back to
`/tmp/eval-claude-md-gen/CLAUDE.md`.

### services/gateway/CLAUDE.md

```
10:- [Root CLAUDE.md](../../CLAUDE.md)
```

PASS — relative link `../../CLAUDE.md` resolves from
`/tmp/eval-claude-md-gen/services/gateway/` back to
`/tmp/eval-claude-md-gen/CLAUDE.md`.

## Summary

All 3 submodule CLAUDE.md files link back to the root with a relative
path computed from the submodule's depth (2 segments → `../../`). The
generator never emits absolute paths, per the AGENT.md critical rule
"ALWAYS use relative paths for links". The root CLAUDE.md reciprocates
with a `## Submodules` section listing each submodule with relative
forward links.
