# Idempotency Check

Assertion: a second run of the agent against the same wiki state must
produce a byte-identical `CLAUDE.md`.

## Procedure

1. After the first regeneration, snapshot the file to
   `CLAUDE.md.pass1`.
2. Re-run the agent's update action against the same wiki root.
3. Diff the result; compute SHA-256 of both files.

## Commands and output

```
$ cp CLAUDE.md CLAUDE.md.pass1
$ node claude_md_gen.js \
    --project-root /tmp/eval-i3-cmd-preserve \
    --wiki-root   /tmp/eval-i3-cmd-preserve/wiki \
    --update      /tmp/eval-i3-cmd-preserve/CLAUDE.md
Updated: /tmp/eval-i3-cmd-preserve/CLAUDE.md

$ diff -q CLAUDE.md CLAUDE.md.pass1
(no output -> files are identical)

$ shasum -a 256 CLAUDE.md CLAUDE.md.pass1
60b5fa5188ce501052405978db940ee95ad7b2b65fa8806969962512fa27deb5  CLAUDE.md
60b5fa5188ce501052405978db940ee95ad7b2b65fa8806969962512fa27deb5  CLAUDE.md.pass1
```

Both SHA-256 digests match:
`60b5fa5188ce501052405978db940ee95ad7b2b65fa8806969962512fa27deb5`.

Result: PASS -- the agent is idempotent on the same wiki state.
