# Seed Files Check — `/wiki-onboard` on the Django fixture

Wiki root: `/tmp/eval-i3-onboard-django`

Confirming that the three mandatory seed files (required by the eval
assertion "Seed files ... exist — not just empty directories") are
present on disk as files, not as empty directories or missing paths.

## `wiki/index.md`

- **Exists:** yes
- **Type:** regular file
- **Size:** 27 bytes
- **Contents (verbatim):**

```
# Index

Wiki entry point.
```

Source: `INITIAL_WIKI_FILES[0]` in `init_wiki.ts`.

## `graph/edges.jsonl`

- **Exists:** yes
- **Type:** regular file (created via `touchFile()` in `init_wiki.ts`)
- **Size:** 0 bytes (expected — no edges recorded during onboarding; the
  first typed edges are written during `/wiki-ingest` or post-op hooks).
- The file itself exists so append-only writers (`graph_ops.ts`,
  `lint_checks.ts`) never hit ENOENT.

## `log/events.jsonl`

- **Exists:** yes
- **Type:** regular file
- **Size:** 769 bytes (non-empty)
- **Event count:** 2
- **Contents:**

```jsonl
{"ts":"2026-04-14T18:19:28.655000+00:00","op":"init","domain":"django-mongodb","name":"myapp Wiki","created_dirs":["wiki","wiki/claims","wiki/synthesis","wiki/templates","raw","graph","audit/open","audit/resolved","log/daily","outputs/queries","outputs/reports",".wiki-cache"],"created_files":["wiki.config.yaml","wiki/index.md","wiki/summaries.md","wiki/overview.md",".wiki-ignore","log/events.jsonl","graph/edges.jsonl",".claude/settings.json"]}
{"ts":"2026-04-14T18:20:05.749000+00:00","op":"onboard","language":"python","framework":"django","orm":"django","database":"mongodb","entities":[{"class_name":"Article","table_name":"articles","columns":["title","body"]}],"autonomy":"balanced","multimodal":"optional"}
```

The `init` line was appended by `init_wiki.ts`'s built-in
`logEvent(root, "init", ...)` call; the `onboard` line was appended by
the CLI above.

## Additional seed files also created by `init_wiki` (sanity check)

| Path                  | Exists | Notes                                  |
|-----------------------|--------|----------------------------------------|
| `wiki/summaries.md`   | yes    | seeded placeholder                     |
| `wiki/overview.md`    | yes    | seeded placeholder                     |
| `.wiki-ignore`        | yes    | `.git/`, `node_modules/`, `.DS_Store`  |
| `.claude/settings.json` | yes  | Claude Code PreToolUse hooks installed |
| `wiki.config.yaml`    | yes    | onboarded with detected stack          |

## Verdict

All three required seed files (`wiki/index.md`, `graph/edges.jsonl`,
`log/events.jsonl`) are present as regular files — not empty
directories, not missing — satisfying the eval assertion.
