# doc-wiki demo — visual identity

## Style Prompt

Technical, dark, terminal-rooted with clean modern typography. The aesthetic borrows from developer-tool home pages (Linear, Vercel, Anthropic) — deep slate canvas, narrow accent palette, monospace for code, sans-serif for narrative. Restraint over flourish; the artifact does the work — wiki pages, diagrams, cited answers — decoration stays out of the way. No gradients beyond subtle radial vignettes; no neon; no glassmorphism.

## Colors

- `--bg: #0a0e14` — primary canvas, deep slate
- `--panel: #131820` — card / panel background
- `--border: #1f2733` — hairline borders, dividers
- `--text: #d7e0eb` — primary text
- `--text-dim: #6a7585` — secondary text, labels
- `--accent: #58c4dc` — doc-wiki accent (cyan), used for emphasis on key terms, citations, and the headline
- `--success: #62d471` — terminal output only: passing tests, lint ✓ marks, pages-written lines
- `--failure: #e36667` — terminal output only: failing tests, lint ✗ marks. Never map success/failure colors to a with/without-doc-wiki comparison.
- `--warmth: #f1a85c` — soft amber, used sparingly (speed badge, diagram edge labels)

## Typography

- **Display / narrative:** `Inter`, weights 600–800. Sizes 60–140px for headlines, 28–42px for body.
- **Monospace / terminal / code:** `JetBrains Mono`, weight 400–600. Sizes 20–32px.
- `font-variant-numeric: tabular-nums` on every number-bearing element (cost estimate, page counters).

## Motion

- House style: snappy in, no exit anims except final scene. Eases: `power3.out`, `expo.out`, `power2.out`. Durations 0.4–0.8s for content; 0.2s for transitions.
- Stagger 80–140ms between siblings; terminal lines stream at 300–550ms intervals.
- Scene transitions: black overlay clip on `track 1`, fades 0.0→1.0→0.0 across 0.3s straddling the cut.
- Counters (the cost estimate, pages-written) animate smoothly with `power2.out` — informative, not theatrical.

## What NOT to Do

- No accuracy or fix-rate statistics of any kind — no percentages, no before/after or baseline-vs-wiki comparisons, no bar charts comparing conditions. The composition shows the artifact, not a claim. The published benchmark result lives in `benchmark/RESULTS.md`; it does not appear as a visual.
- No Roboto, no Open Sans, no Comic Sans.
- No `#3b82f6` blue (the generic Tailwind default). Use `--accent` (`#58c4dc`) instead.
- No screenshot of a real Claude Code session — every "terminal" frame is stylized text in the composition. The point is reliable hero rendering, not faked authenticity.
- No `repeat: -1` anywhere. No `Math.random()`. No `Date.now()`. (Hyperframes hard rules.)
- No exit animations on scene content (transition overlays handle the cut).
- No emojis in the composition itself. ✓ and ✗ are characters but functional, not decorative.
