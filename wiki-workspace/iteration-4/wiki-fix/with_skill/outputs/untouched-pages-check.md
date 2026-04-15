# Untouched pages — sha256 before vs after

Snapshots `_snap-db.md` and `_snap-cache.md` captured immediately after seeding
and BEFORE the fix was applied. Post-fix, the live wiki copies of
`wiki/database.md` and `wiki/caching.md` are hashed again and compared.

| file                       | sha256 (snapshot / before)                                         | sha256 (live / after)                                              | match |
|----------------------------|--------------------------------------------------------------------|--------------------------------------------------------------------|-------|
| wiki/database.md           | `695c700c8c1de4293a0579d336486ad8f6665d2fc5e6999f01be49bc1744e296` | `695c700c8c1de4293a0579d336486ad8f6665d2fc5e6999f01be49bc1744e296` | YES   |
| wiki/caching.md            | `f6b621a62329e416d2dbbde85788b436d178269a5b90d9f06d924da8261f5261` | `f6b621a62329e416d2dbbde85788b436d178269a5b90d9f06d924da8261f5261` | YES   |

## authentication.md (the fixed page) for reference

| timepoint | sha256                                                             |
|-----------|--------------------------------------------------------------------|
| before    | `49eb3333b2ca8f52f620f0c9d118fe6e9f4c009e5cf22114106318e0166ce42a` |
| after     | `c75f0324a7f69118f9f7486f0850f70854ec03c05109ec8f9c0e05a56817e9b2` |

Hash changed as expected (HS256 -> RS256 swaps + `updated` bump). The two
unrelated pages are byte-identical to their pre-fix snapshots, confirming the
fix touched exactly one file.

```
$ shasum -a 256 _snap-db.md _snap-cache.md wiki/database.md wiki/caching.md wiki/authentication.md
695c700c8c1de4293a0579d336486ad8f6665d2fc5e6999f01be49bc1744e296  _snap-db.md
f6b621a62329e416d2dbbde85788b436d178269a5b90d9f06d924da8261f5261  _snap-cache.md
695c700c8c1de4293a0579d336486ad8f6665d2fc5e6999f01be49bc1744e296  wiki/database.md
f6b621a62329e416d2dbbde85788b436d178269a5b90d9f06d924da8261f5261  wiki/caching.md
c75f0324a7f69118f9f7486f0850f70854ec03c05109ec8f9c0e05a56817e9b2  wiki/authentication.md
```
