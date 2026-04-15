# Idempotency check — re-running the agent must leave the file byte-identical

## Procedure

1. First update already performed (see `CLAUDE-after.md`).
2. Snapshot the file to `/tmp/eval-claude-md-preserve.after-first-run.md`.
3. Run the agent a SECOND time against the same project and file:

   ```bash
   node .claude/agents/wiki-claude-md-agent/scripts/claude_md_gen.js \
     --project-root /tmp/eval-claude-md-preserve \
     --wiki-root   /tmp/eval-claude-md-preserve/wiki \
     --update      /tmp/eval-claude-md-preserve/CLAUDE.md
   ```

4. Compare with `cmp` (byte-for-byte) and `shasum`.

## Hashes (sha256)

| State                 | sha256 |
|-----------------------|--------|
| After 1st invocation  | `7bcdbe33b3344b67a4dc325c3585464abf850f08ee22cf1e8be41e4e39d1ab4a` |
| After 2nd invocation  | `7bcdbe33b3344b67a4dc325c3585464abf850f08ee22cf1e8be41e4e39d1ab4a` |

## `cmp` result

```
$ cmp /tmp/eval-claude-md-preserve/CLAUDE.md /tmp/eval-claude-md-preserve.after-first-run.md
(exit 0 — files are byte-identical)
```

## `diff -u` result

```diff
(empty — no output)
```

## Verdict

PASS — the second invocation produced a file that is byte-identical to the first. The `claude_md_gen` marker-replacement strategy is deterministic: given the same project layout and wiki root, the regex `MARKER_START\n(.*?)MARKER_END` matches the just-written managed block and replaces it with the same content. No whitespace drift, no duplicate markers, no trailing-newline creep.
