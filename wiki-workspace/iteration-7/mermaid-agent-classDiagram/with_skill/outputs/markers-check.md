# Markers check

## Marker counts in after.md:
- `<!-- wiki-mermaid: start -->` count: 1  (exactly one, on line 5)
- `<!-- wiki-mermaid: end -->` count: 1    (exactly one, on line 22)

## Block position relative to markers:
- Line 5:  `<!-- wiki-mermaid: start -->`
- Line 6:  `%% Title: Class Hierarchy`   ← injected content starts here
- Line 7:  ` ```mermaid`
- Line 8:  `classDiagram`
- ...
- Line 21: ` ``` `                        ← injected content ends here
- Line 22: `<!-- wiki-mermaid: end -->`

RESULT: The mermaid block is injected BETWEEN the two markers. No EOF append occurred.
Both markers are intact and appear exactly once.
