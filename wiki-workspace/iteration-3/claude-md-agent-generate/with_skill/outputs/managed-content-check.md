# Managed Section Non-Empty Content Check

**Assertion:** Each file's region between start/end markers contains at least an
Overview heading OR a non-empty link to wiki/index.md. Empty markers fail.

## Extracted managed sections (between markers)

### Root `/tmp/eval-i3-cmd-gen/CLAUDE.md`

- `## Overview` heading: present (line 2)
- Wiki link: `- [Wiki documentation](wiki/index.md)` (line 6)
- `## Submodules`, `## Build & Run`, `## Service Dependencies`, `## Database References` headings all present
- Non-empty: yes

### `/tmp/eval-i3-cmd-gen/services/api/CLAUDE.md`

- `## Overview` heading: present
- Wiki link: `- [Wiki documentation](wiki/index.md)`
- `## Parent Project` with `- [Root CLAUDE.md](../../CLAUDE.md)`
- Non-empty: yes

### `/tmp/eval-i3-cmd-gen/services/worker/CLAUDE.md`

- `## Overview` heading: present
- Wiki link: `- [Wiki documentation](wiki/index.md)`
- `## Parent Project` with `- [Root CLAUDE.md](../../CLAUDE.md)`
- Non-empty: yes

### `/tmp/eval-i3-cmd-gen/services/gateway/CLAUDE.md`

- `## Overview` heading: present
- Wiki link: `- [Wiki documentation](wiki/index.md)`
- `## Parent Project` with `- [Root CLAUDE.md](../../CLAUDE.md)`
- Non-empty: yes

## Verdict

PASS — every file's managed section contains both an `## Overview` heading and a
non-empty wiki link (`wiki/index.md`). No empty markers anywhere.
