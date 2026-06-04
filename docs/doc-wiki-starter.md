# doc-wiki starter — drop this into your CLAUDE.md

> A 60-line tasteable version of the doc-wiki pattern. Use it to feel the wiki-first
> flow on any codebase before you install the full plugin
> (`claude plugin install narailabs/doc-wiki`). Drop the block below into your project's
> `CLAUDE.md` (or paste it at the top of your first conversation) and re-read it
> each session.

---

```markdown
# Wiki-first coding (doc-wiki starter)

You are working on this codebase with a maintained wiki at `docs/wiki/`. Before
modifying code, you must read the wiki page that covers the area you're about
to touch. If the relevant page doesn't exist, create it before writing code.

## Reading rules
1. Start every session by reading `docs/wiki/summaries.md` — one ~50-token
   summary per page. Treat it as your table of contents.
2. Before changing any file at `<path>`, search `docs/wiki/` for a page whose
   `sources:` frontmatter lists that file. If you find one, read it in full.
3. If you find no page covering the file, run the "Page-creation rules" below
   *first* and only then change the code.

## Page-creation rules
A wiki page is a markdown file under `docs/wiki/<topic>/<slug>.md`. Required
frontmatter:
   - title (≤80 chars)
   - type (`concept` / `runbook` / `decision` / `reference`)
   - tags (3–8 content tags, no structural ones)
   - sources (paths or URLs the page summarizes)
   - created / updated (ISO date)

After the frontmatter: a 2–4 paragraph distillation of *why this code is the
way it is*, not what the code does. The reader is a future you who has 30
seconds and needs to make a non-obvious decision. Include past attempts and
why they failed if you know them.

## Updating rules
1. When you change code, update the wiki page that covers it in the same diff.
2. When a wiki page's claims contradict the code, fix the page first, code
   second.
3. Remove pages whose `sources:` no longer exist; archive them to
   `docs/wiki/_archive/`.

## Why this works
Most coding agents fail on real codebases because they re-derive everything
from raw source every turn, miss the "we tried that in 2023" footnote, and
confidently produce plausible-looking but wrong diffs. The wiki is your
working memory across sessions. It compounds; raw context doesn't.

This is the [LLM Wiki pattern](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)
described by Andrej Karpathy, applied to code instead of personal notes.
```

---

## Why this is a starter and not the full thing

The block above gets you ~30% of the value of the doc-wiki plugin with zero install. The full plugin adds:

- Automated ingest from Jira / Confluence / GitHub / Notion / AWS / GCP / databases via one planner (`gather()` from `narai-primitives`).
- ORM-to-table mapping with 7 profiles (Prisma, SQLAlchemy, Django, JPA, TypeORM, ActiveRecord, Entity Framework).
- Mermaid diagram generation per page.
- `/doc-wiki:atlas` — full-codebase documentation in one phased pass.
- `/doc-wiki:query` with cited synthesis + path-mode shortest-path between concepts.
- `/doc-wiki:lint` and `/doc-wiki:fix` for self-healing.
- Content-hash drift detection.
- Four autonomy modes.

Install when you're ready:

```sh
claude plugin install narailabs/doc-wiki
```

Or read the manifesto first: [`docs/manifesto.md`](manifesto.md). Or reproduce the benchmark: [`benchmark/`](../benchmark/). Apache 2.0 forever.
