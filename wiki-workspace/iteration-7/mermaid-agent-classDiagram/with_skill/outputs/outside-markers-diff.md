# Outside-markers diff

Content outside `<!-- wiki-mermaid: start -->` and `<!-- wiki-mermaid: end -->` markers
was extracted from `before.md` and `after.md` and compared line-by-line.

## Lines retained (before and after both):
1: `# Class hierarchy\n`
2: `\n`
3: `Some preamble text.\n`
4: `\n`
5: `<!-- wiki-mermaid: start -->\n`  (marker itself preserved)
6: `<!-- wiki-mermaid: end -->\n`    (marker itself preserved)
7: `\n`
8: `Post-marker text that must be preserved byte-for-byte.\n`

## Result

IDENTICAL — no diff. All 8 lines outside-or-at-markers are byte-for-byte equal before and after the run.
