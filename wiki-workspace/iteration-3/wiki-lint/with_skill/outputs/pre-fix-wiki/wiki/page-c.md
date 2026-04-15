# Page C — Charlie Concept

Page C has no frontmatter at all. The linter must report this as a
missing_frontmatter violation and the fixer must add the required fields
(title, type, tags, sources, created, updated, quality, summary) without
touching the body content below.

This paragraph references a [missing](./ghost.md) target that the linter
must also flag as a broken link. The broken-link fix must preserve every
other word of this paragraph unchanged.

Charlie is the third concept in the sequence and depends on the vocabulary
introduced in the earlier pages. The prose here is deliberately specific
so we can detect any unintended rewriting during auto-fix.
