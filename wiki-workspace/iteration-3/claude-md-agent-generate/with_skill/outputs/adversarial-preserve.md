# Adversarial Preservation Check (User Edit Outside Markers)

**Assertion:** When the user edits content OUTSIDE the managed markers between
runs (e.g., adds a new heading/comment above the start marker), the next
generation preserves that edit unchanged.

## Procedure

1. After an initial run, the root `/tmp/eval-i3-cmd-gen/CLAUDE.md` starts on
   line 1 with `<!-- wiki-managed: start -->`.
2. Manually insert the line `<!-- user-added: testnote -->` ABOVE the start
   marker. Root CLAUDE.md now begins with 2 lines before the managed section.
3. Re-run the generator against root:
   ```bash
   node .claude/agents/wiki-claude-md-agent/scripts/claude_md_gen.js \
     --project-root /tmp/eval-i3-cmd-gen \
     --wiki-root /tmp/eval-i3-cmd-gen/wiki \
     --update /tmp/eval-i3-cmd-gen/CLAUDE.md
   ```
4. Verify the user-added line is still present and unmodified.

## Before re-run (adversarial state)

```
<!-- user-added: testnote -->
<!-- wiki-managed: start -->
## Overview
...
<!-- wiki-managed: end -->
```

## After re-run

```
<!-- user-added: testnote -->
<!-- wiki-managed: start -->
## Overview
...
<!-- wiki-managed: end -->
```

## Diff (before vs after) around the user-added line

```
$ diff <(head -2 <before>) <(head -2 <after>)
(empty — first two lines identical)
```

The line `<!-- user-added: testnote -->` at line 1 is:

- Still present
- Still ABOVE the start marker (outside the managed region)
- Byte-identical to the adversarial insert

The managed region itself was regenerated (same byte content as run 2 since
inputs did not change), but nothing outside the markers was touched.

## Why this works

`updateClaudeMd()` in `claude_md_gen.ts` finds the single balanced
`<!-- wiki-managed: start -->` … `<!-- wiki-managed: end -->` pair and uses
`content.replace(_MANAGED_RE, replacement)` — a single-match replace that
only substitutes the text BETWEEN (and including) the two markers. Everything
before the start marker and after the end marker is left as-is. The
`G-CLAUDE-MD-MARKER` guard (lines 188-200) further refuses to mutate the file
if markers are unbalanced, so hand-edits inside the managed region don't cause
silent corruption either.

## Verdict

PASS — the user-added line above the start marker survives the re-run
unchanged.
