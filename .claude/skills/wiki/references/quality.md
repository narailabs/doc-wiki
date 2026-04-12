# Quality Scoring & Tag Philosophy

## Quality Score (0.0-1.0)

Run `quality_score.py` to compute scores. Stored in page frontmatter as `quality: 0.82`.

### Content-level scoring

| Signal | Score |
|---|---|
| Word count < 50 | 0.1 base |
| Word count 50-150 | 0.3 base |
| Word count 150-500 | 0.6 base |
| Word count 500+ | 0.8 base |
| Complete frontmatter (all required fields) | +0.1 |
| 3+ cross-reference links | +0.1 |
| 4+ concept tags | +0.05 |
| Missing title | -0.3 |
| No sources cited | -0.2 |
| No summary field | -0.1 |
| Claim: has evidence list | +0.1 |
| Claim: deprecated without failure_reason | -0.2 |

### Structural signal (from edges.jsonl)

| Signal | Score |
|---|---|
| Top 10% highest-degree node (god-node) | +0.1 |
| Degree <= 1 (isolated node) | -0.2 |
| Has Mermaid diagram (for DB-backed or architecture pages) | +0.05 |
| Missing Mermaid where expected | -0.1 (info tier only) |

Combined score clamped to [0.0, 1.0].

### Uses

- During queries: higher-quality pages weighted more in synthesis
- During lint: surfaces weak pages ("these 5 pages score below 0.4")
- In summaries.md: score included so queries can prioritize

## Tag Philosophy — Content-Only

Tags connect ideas. A tag answers: "If someone searched for this tag, would finding these pages together be useful?"

### Good tags
- Named theories: `ELM-model`, `transformer-architecture`, `CAP-theorem`
- Core subjects: `consumer-behavior`, `distributed-systems`
- Techniques: `A-B-testing`, `gradient-descent`, `content-analysis`
- Cross-cutting themes on 2+ pages: `audience-segmentation`

### Bad tags (exclude)
- Page types: `concept`, `entity` — the `type` field handles this
- Numbering: `chapter-5`, `section-3` — path encodes this
- Temporal: `april-2026`, `Q2-2026` — dates handle this
- Metadata: `important`, `reference`, `draft` — not concepts

### Tag reuse

A tag on only one page connects nothing. Before creating new tags, check existing vocabulary. Most tags should appear on 2-5 pages.

Guidelines: 4-8 concept tags per page. Even index pages get broad domain-level tags.

## Mermaid Lint

Extract all fenced Mermaid blocks from wiki pages. Validate syntax. Report parse errors as lint warnings (non-blocking).
