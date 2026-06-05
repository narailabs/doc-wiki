# doc-wiki demo — visual identity

## Style Prompt

Technical, dark, terminal-rooted with clean modern typography. The aesthetic borrows from developer-tool home pages (Linear, Vercel, Anthropic) — deep slate canvas, narrow accent palette, monospace for code, sans-serif for narrative. Restraint over flourish; the headline numbers do the work, decoration stays out of the way. No gradients beyond subtle radial vignettes; no neon; no glassmorphism.

## Colors

- `--bg: #0a0e14` — primary canvas, deep slate
- `--panel: #131820` — card / panel background
- `--border: #1f2733` — hairline borders, dividers
- `--text: #d7e0eb` — primary text
- `--text-dim: #6a7585` — secondary text, labels
- `--accent: #58c4dc` — doc-wiki accent (cyan), used for emphasis on key terms and the headline
- `--success: #62d471` — passing tests, ✓ marks, "with doc-wiki" condition
- `--failure: #e36667` — failing tests, ✗ marks, "baseline" condition
- `--warmth: #f1a85c` — soft amber, used sparingly for highlighting Claude Code references

## Typography

- **Display / narrative:** `Inter`, weights 600–800. Sizes 60–140px for headlines, 28–42px for body.
- **Monospace / terminal / code:** `JetBrains Mono`, weight 400–600. Sizes 22–32px.
- `font-variant-numeric: tabular-nums` on every number-bearing element (counters, percentages, the bar chart).

## Motion

- House style: snappy in, no exit anims except final scene. Eases: `power3.out`, `expo.out`, `power2.out`. Durations 0.4–0.8s for content; 0.2s for transitions.
- Stagger 80–140ms between siblings.
- Scene transitions: black overlay clip on `track 1`, fades 0.0→1.0→0.0 across 0.3s straddling the cut.
- The numbers (10%, 80%, the bar chart) should land hard — use a snappy ease and a brief scale overshoot.

## What NOT to Do

- No Roboto, no Open Sans, no Comic Sans.
- No `#3b82f6` blue (the generic Tailwind default). Use `--accent` (`#58c4dc`) instead.
- No screenshot of a real Claude Code session — every "terminal" frame is stylized text in the composition. The point is reliable hero rendering, not faked authenticity.
- No `repeat: -1` anywhere. No `Math.random()`. No `Date.now()`. (Hyperframes hard rules.)
- No exit animations on scene content (transition overlays handle the cut).
- No emojis in the composition itself. ✓ and ✗ are characters but functional, not decorative.
