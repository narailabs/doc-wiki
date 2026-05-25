---
description: Search + synthesize the wiki, find concept paths, or save query answers as wiki pages
argument-hint: '<question> | --from <a> --to <b> [--max-hops <N>] [--via <c>] [--all-paths] [--max-depth <N>] | --promote <file|last|N> | --review [--since <dur>] [--limit <N>] [--topic <dir>] [--wiki-root <path>]'
allowed-tools: Skill(doc-wiki)
---

Invoke the `doc-wiki` skill to run the `/doc-wiki:query` workflow with the user's arguments: $ARGUMENTS

Call `Skill(doc-wiki, "query $ARGUMENTS")`. The skill orchestrator reads `skills/doc-wiki/SKILL.md`, locates the `### /doc-wiki:query — Summary-first search + synthesis` section, and dispatches one of four modes:

- **Synthesis mode** (default): runs the summary-first flow — read `summaries.md`, score relevance, load top-N pages, follow links up to 5 levels, synthesize with citations, surface contradictions, archive to `outputs/queries/`, log token efficiency. After the answer, prompts "Save this answer as a permanent wiki page?" (gated by autonomy mode).
- **Path mode** (when `--from` and `--to` are present): shells out to `graph_ops.js path` against `<wiki-root>/graph/edges.jsonl` and returns the typed-edge chain connecting the two concepts. Skips summary-first scoring, link-following, synthesis, and the promote prompt.
- **Promote mode** (when `--promote <file|last|N>` is present): converts an archived answer in `outputs/queries/` into a wiki page (frontmatter, citation→link rewriting, topic placement). Argument forms: `last`/`latest` → most recent; integer `N` → Nth most recent; path → as-is; single token → filename substring match; empty → list-and-pick.
- **Review mode** (when `--review` is present): bulk archive triage with per-item P/S/D/A approval, honoring autonomy mode. Supports `--since <duration>`, `--limit <N>`, and `--topic <dir>` for filtering.

If `$ARGUMENTS` is empty, ask the user what they want: a question to answer (synthesis mode), two concepts to connect (path mode), an archive to promote, or a batch review of archives.
