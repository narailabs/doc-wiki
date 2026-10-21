# scope-check

Verifies assertion: only the named target file (`pipeline.md`) is modified; no
other `.md` files in the working directory change across the three generator
runs.

## Decoy file

A second markdown file `unrelated.md` was placed in
`/tmp/eval-i3-mermaid-flow/` before any run. It too contains wiki-mermaid
markers (so a buggy generator that scanned siblings would have rewritten it).

```
$ cat /tmp/eval-i3-mermaid-flow/unrelated.md
---
title: Unrelated page
---

# Unrelated page

This file must not be modified by the generator.

<!-- wiki-mermaid: start -->
Placeholder — not a real target.
<!-- wiki-mermaid: end -->
```

## SHA-256 before vs after all three runs

| Moment | sha256(unrelated.md) |
|---|---|
| before any generator run | `43fea567c596ae67d4273581b754365e2037b166943358b75e499f18c730b781` |
| after run 1 (input-1)    | `43fea567c596ae67d4273581b754365e2037b166943358b75e499f18c730b781` |
| after run 2 (input-2)    | `43fea567c596ae67d4273581b754365e2037b166943358b75e499f18c730b781` |
| after run 3 (input-1)    | `43fea567c596ae67d4273581b754365e2037b166943358b75e499f18c730b781` |

Hash is constant across all four moments. The decoy was untouched.

## File list in /tmp/eval-i3-mermaid-flow/

```
input-1.json
input-2.json
pipeline-before.md      (local snapshot, pre-run)
pipeline.md             (the sole target — modified by the generator)
unrelated.md            (decoy — untouched)
```

No extra `.md` files appeared; no other `.md` files were modified.
