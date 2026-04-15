# Wiki-managed marker check

Grep for `<!-- wiki-managed: start -->` and `<!-- wiki-managed: end -->` in every generated file. Each file must contain exactly one start and one end marker.

Command:

```bash
grep -n 'wiki-managed:' <file>
```

## Results

### /tmp/eval-claude-md-gen/CLAUDE.md (root)

```
1:<!-- wiki-managed: start -->
25:<!-- wiki-managed: end -->
```

start=1, end=1 — PASS

### /tmp/eval-claude-md-gen/services/api/CLAUDE.md

```
1:<!-- wiki-managed: start -->
23:<!-- wiki-managed: end -->
```

start=1, end=1 — PASS

### /tmp/eval-claude-md-gen/services/worker/CLAUDE.md

```
1:<!-- wiki-managed: start -->
23:<!-- wiki-managed: end -->
```

start=1, end=1 — PASS

### /tmp/eval-claude-md-gen/services/gateway/CLAUDE.md

```
1:<!-- wiki-managed: start -->
23:<!-- wiki-managed: end -->
```

start=1, end=1 — PASS

## Summary

All 4 generated CLAUDE.md files contain exactly one balanced pair of
`<!-- wiki-managed: start -->` / `<!-- wiki-managed: end -->` markers.
This is the invariant `updateClaudeMd` (`claude_md_gen.ts`) enforces via
the `MarkerCorruptError` guard (G-CLAUDE-MD-MARKER).
