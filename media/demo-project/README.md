# doc-wiki demo composition

60-second stylized demo: repo → atlas → wiki → cited answers. HyperFrames composition; no real screen captures — every frame is rendered HTML.

Source of truth: [`index.html`](index.html). Visual identity: [`DESIGN.md`](DESIGN.md). Eight scenes:

| # | Time | What |
|---|---|---|
| 1 | 0–5s | Root repo — `git submodule status`, services as submodules, zero docs |
| 2 | 5–11s | `/doc-wiki:atlas --dry-run` — topics, `(topic × facet)` batches, cost estimate before anything is written |
| 3 | 11–23s | `/doc-wiki:atlas` running — page paths streaming, "10×" speed badge pinned top-right |
| 4 | 23–30s | The wiki lands in the repo — file tree, architecture page (frontmatter + flowchart), `graph/edges.jsonl` |
| 5 | 30–38s | ORM model → generated ER diagram, matching entity highlighted in both panes |
| 6 | 38–46s | Cross-service map — services + typed edges; "Single repo? Same wiki, leaner." |
| 7 | 46–54s | `/doc-wiki:query` — answer with inline citations to wiki pages |
| 8 | 54–60s | Closing card — "The wiki is the product. The benchmark is public — including where it lost." + install command + URL |

## Lint / inspect / render

```sh
cd media/demo-project
npx hyperframes lint        # syntax + structure check
npx hyperframes inspect     # headless Chrome layout sweep
npx hyperframes preview     # local studio with hot reload
npx hyperframes render --quality draft   # ~3-5 min, draft quality
npx hyperframes render --fps 60 --quality high   # final, ~10-20 min
```

Renders land under `renders/`. Copy the final to `../demo.mp4` to power the README hero.

## Output formats needed for the launch

- `media/demo.mp4` — 1920×1080, H.264 — pinned X tweet, Loom outreach
- `media/demo-hero.gif` — 6s loop of the cross-service-map beat (39.5–45.5s: edges draw in, caption lands), 960 wide, 15 fps — HN thread, README hero. Generate from MP4 with a two-pass palette (single-pass gif quantization tints the dark canvas green):
  ```sh
  ffmpeg -ss 39.5 -i ../demo.mp4 -t 6 -vf "fps=15,scale=960:-1,palettegen=stats_mode=diff" palette.png
  ffmpeg -ss 39.5 -i ../demo.mp4 -i palette.png -lavfi "fps=15,scale=960:-1[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5" -t 6 ../demo-hero.gif
  ```
  Then verify frame-by-frame that no stray numbers appear.
- `media/demo.webm` — optional, for sites that want VP9

## Editing notes

- Color/font changes go through `DESIGN.md` first, then propagate.
- No accuracy or fix-rate statistics anywhere in the composition — no percentages, no baseline-vs-wiki comparison, no bar charts. The published benchmark result lives at `../../benchmark/RESULTS.md` and is referenced qualitatively on the closing card only ("including where it lost"). See `DESIGN.md` → "What NOT to Do".
- The fixture repo (orders / inventory / payments / notifications, `docs/shop-wiki/`) is synthetic. Keep it generic — no real ticket IDs, no private or employer codebase references.
- The "10×" badge stays on screen for the whole atlas-run scene; if you retime scene 3, keep the badge covering the sped-up footage.
