# doc-wiki demo composition

60-second stylized failure→fix→success demo. HyperFrames composition; no real screen captures — every frame is rendered HTML.

Source of truth: [`index.html`](index.html). Visual identity: [`DESIGN.md`](DESIGN.md). Five scenes:

| # | Time | What |
|---|---|---|
| 1 | 0–3s | "Claude Code on a real ticket. Watch." |
| 2 | 3–15s | Baseline failure — Jira ticket, wrong fix, ✗ FAIL, "10% autonomous" |
| 3 | 15–30s | `/doc-wiki:atlas` — sources ingest, wiki materializes |
| 4 | 30–50s | With-doc-wiki retry — same ticket, ✓ PASS, "80% autonomous" |
| 5 | 50–60s | Headline bar chart, logo, URL, Apache-2.0 forever |

## Lint / inspect / render

```sh
cd media/demo-project
npx hyperframes lint        # syntax + structure check
npx hyperframes inspect     # headless Chrome layout sweep
npx hyperframes preview     # local studio with hot reload
npx hyperframes render --quality draft   # ~3-5 min, draft quality
npx hyperframes render --fps 30 --quality high   # final, ~10-20 min
```

Renders land under `renders/`. Copy the final to `../demo.mp4` to power the README hero.

## Output formats needed for the launch

- `media/demo.mp4` — 1920×1080, H.264 — pinned X tweet, Loom outreach
- `media/demo.gif` — 1280×720 max, ≤6s loop of the punchiest 6 seconds (recommend 38–44s, the "PASS + 80%" beat) — HN thread, README hero. Generate from MP4 with `ffmpeg -i demo.mp4 -ss 38 -t 6 -vf "fps=15,scale=1280:-1" demo.gif`.
- `media/demo.webm` — optional, for sites that want VP9

## Editing notes

- Color/font changes go through `DESIGN.md` first, then propagate.
- Numbers in the bar chart are the headline; do not change them without updating the benchmark + README in sync.
- The Jira ticket ID "AUTH-1247" is fictional but plausible. If you want a real Mastodon/Cal.com/Django ticket reference here, the curated benchmark issues at `../../benchmark/repos.yaml` are the source.
