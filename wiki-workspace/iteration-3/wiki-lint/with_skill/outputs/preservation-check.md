# Body preservation check — pre-fix vs post-fix

For each seeded page, this diff compares the **body** (everything after the closing `---` frontmatter delimiter) pre-fix (from `/tmp/eval-i3-lint-wiki/original-bodies/`) against post-fix (from `/tmp/eval-i3-lint-wiki/wiki/`). The goal: no body prose may be rewritten by auto-fix — only the specific fix region (frontmatter fields added / broken link handled) may change.

Method used:

```bash
awk 'BEGIN{fm=0} /^---$/{fm++;next} fm>=2{print}' <file>
```

This strips the YAML frontmatter block and emits only the body.

## Per-page results

### page-a.md — expected change: none (stub target created elsewhere)

The broken link `[D](./page-d.md)` was healed by creating a stub `page-d.md`, NOT by editing page-a's body.

```
diff body-pre-a.txt body-post-a.txt
(no output)
```

**Result:** body byte-identical. PASS.

### page-b.md — expected change: frontmatter only

Auto-fix added `tags:` and `sources:` to the frontmatter. Body untouched.

```
diff body-pre-b.txt body-post-b.txt
(no output)
```

**Result:** body byte-identical. PASS.

### page-c.md — expected change: new frontmatter block + broken-link removal inside body

Pre-fix page-c had NO frontmatter at all, so the diff below compares the whole original file to the post-fix body (after stripping the new frontmatter block). Two legitimate fix-region changes are expected:

1. A leading blank line — the byte between the new closing `---` and the first body line is emitted by the awk body-extractor as an empty line.
2. The broken link `[missing](./ghost.md)` collapsed to plain text `missing` — this is the "remove the link" branch of the broken-link fix rule.

```
diff body-pre-c.txt body-post-c.txt
0a1
> 
8c9
< This paragraph references a [missing](./ghost.md) target that the linter
---
> This paragraph references a missing target that the linter
```

Every other byte of page-c prose — the title, the explanatory paragraphs, the "Charlie is the third concept..." closing — is preserved exactly. No headings rewritten, no sentences paraphrased.

**Result:** changes confined to the fix region (new frontmatter + broken link removed). PASS.

### page-e.md — expected change: none (control page, no violations)

```
diff body-pre-e.txt body-post-e.txt
(no output)
```

**Result:** body byte-identical. PASS.

## Summary

| Page | Body preserved outside fix region? | Notes |
|---|---|---|
| page-a.md | yes | broken link healed by stub-creation, page body untouched |
| page-b.md | yes | only `tags` + `sources` fields added to frontmatter |
| page-c.md | yes | new frontmatter block added; broken link replaced with plain text — no other prose changes |
| page-e.md | yes | control page; no changes at all |

All four pages satisfy the preservation contract: **original headings and primary prose are preserved byte-identically outside the fix region**.
