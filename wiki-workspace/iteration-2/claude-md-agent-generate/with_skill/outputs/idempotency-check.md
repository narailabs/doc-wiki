# Idempotency check

Running `claude_md_gen.js --update <file>` a second time (with the same
inputs) must produce byte-identical files. The managed section is
regenerated deterministically from `projectRoot`, `wikiRoot`, the sorted
submodule list, and the optional `--submodule` flag; content outside
markers is preserved by regex replacement.

## Method

1. Run the full 4-file generation sequence (3 submodules + root).
2. Snapshot the project tree to `/tmp/eval-claude-md-gen-snapshot1`.
3. Re-run the same 4-file generation sequence on
   `/tmp/eval-claude-md-gen`.
4. Diff the snapshot against the live tree with `diff -ru`.

## Commands

```bash
cp -r /tmp/eval-claude-md-gen /tmp/eval-claude-md-gen-snapshot1

node .../claude_md_gen.js \
  --project-root /tmp/eval-claude-md-gen \
  --wiki-root   /tmp/eval-claude-md-gen/wiki \
  --submodule   services/api \
  --update      /tmp/eval-claude-md-gen/services/api/CLAUDE.md
# ... repeat for worker, gateway, and the root ...

diff -ru /tmp/eval-claude-md-gen-snapshot1 /tmp/eval-claude-md-gen
echo "exit=$?"
```

## Output

```
Updated: /tmp/eval-claude-md-gen/services/api/CLAUDE.md
Updated: /tmp/eval-claude-md-gen/services/worker/CLAUDE.md
Updated: /tmp/eval-claude-md-gen/services/gateway/CLAUDE.md
Updated: /tmp/eval-claude-md-gen/CLAUDE.md
---DIFF_EXIT=0---
```

No diff output. `diff` exit code 0 confirms the two trees are
byte-identical.

## Result

PASS — the generator is idempotent. A second run yields no changes to
any of the 4 CLAUDE.md files, as required by the managed-section
contract.
