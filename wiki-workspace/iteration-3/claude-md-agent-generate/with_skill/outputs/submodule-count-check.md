# Submodule Link Count Check (Root CLAUDE.md)

**Assertion:** Root CLAUDE.md lists EXACTLY three submodule links — one per
discovered submodule — with relative paths that resolve to real CLAUDE.md files
under the submodule dirs.

## Command

```bash
grep -E '^- \[[^]]+\]\([^)]+/CLAUDE\.md\)' /tmp/eval-i3-cmd-gen/CLAUDE.md
```

## Matches (under `## Submodules`)

```
11:- [services/api](services/api/CLAUDE.md)
12:- [services/gateway](services/gateway/CLAUDE.md)
13:- [services/worker](services/worker/CLAUDE.md)
```

**Count: 3** (matches `expected == 3`).

## Link-target resolution

Each link was resolved relative to the root CLAUDE.md directory
(`/tmp/eval-i3-cmd-gen/`) and confirmed to exist on disk:

| Link text | Link href | Resolved path | Exists |
|---|---|---|---|
| `services/api` | `services/api/CLAUDE.md` | `/tmp/eval-i3-cmd-gen/services/api/CLAUDE.md` | yes (418 B) |
| `services/gateway` | `services/gateway/CLAUDE.md` | `/tmp/eval-i3-cmd-gen/services/gateway/CLAUDE.md` | yes (418 B) |
| `services/worker` | `services/worker/CLAUDE.md` | `/tmp/eval-i3-cmd-gen/services/worker/CLAUDE.md` | yes (418 B) |

## Verdict

PASS — exactly 3 links, each target resolves to a real CLAUDE.md file.
