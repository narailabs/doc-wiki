# Idempotency Check

**Assertion:** Running the generator a second time produces byte-identical
CLAUDE.md files (diff -ru is empty).

## Procedure

1. **Run 1:** generate all 4 CLAUDE.md files (3 submodules, then root).
2. Snapshot all four files into `/tmp/eval-i3-cmd-gen/_snapshots/run1/`.
3. **Run 2:** regenerate all 4 files with the same inputs — no edits between runs.
4. `diff` run2 outputs against run1 snapshots.

## Commands

```bash
# Run 2 (same flags as Run 1)
node agents/wiki-claude-md-agent/scripts/claude_md_gen.js \
  --project-root /tmp/eval-i3-cmd-gen --wiki-root /tmp/eval-i3-cmd-gen/wiki \
  --submodule services/api --update /tmp/eval-i3-cmd-gen/services/api/CLAUDE.md
# (and similarly for services/worker, services/gateway, and the root)

diff /tmp/eval-i3-cmd-gen/_snapshots/run1/root-CLAUDE.md     /tmp/eval-i3-cmd-gen/CLAUDE.md
diff /tmp/eval-i3-cmd-gen/_snapshots/run1/api-CLAUDE.md      /tmp/eval-i3-cmd-gen/services/api/CLAUDE.md
diff /tmp/eval-i3-cmd-gen/_snapshots/run1/worker-CLAUDE.md   /tmp/eval-i3-cmd-gen/services/worker/CLAUDE.md
diff /tmp/eval-i3-cmd-gen/_snapshots/run1/gateway-CLAUDE.md  /tmp/eval-i3-cmd-gen/services/gateway/CLAUDE.md
```

## Output

```
---api---
---worker---
---gateway---
---end---
```

All four diffs returned empty. No file content changed between run 1 and run 2.

## Verdict

PASS — re-running the generator on unchanged inputs produces byte-identical
CLAUDE.md files across all 4 locations. Idempotency holds.
