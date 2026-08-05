# Managed section — change check (proves the tool actually ran)

Region examined: everything from `<!-- wiki-managed: start -->` through `<!-- wiki-managed: end -->` (markers inclusive).

## Hashes (sha256)

| State  | sha256 |
|--------|--------|
| Before | `b5f13169ddb5adf472eb8b910b3d986418d0e096083c7a20b66accd228f17498` |
| After  | `000fe78d95f8d562a4296dc507755921104905cdfd4a9a7de635bfba3be8c258` |

**Changed.** The managed section was rewritten by `claude_md_gen.js --update`, replacing the stale placeholder line with freshly generated content (Overview, Build & Run, Service Dependencies, Database References).

## Unified diff (`diff -u` before vs. after)

```diff
--- /tmp/eval-claude-md-preserve.managed.before.txt
+++ /tmp/eval-claude-md-preserve.managed.after.txt
@@ -1,3 +1,19 @@
 <!-- wiki-managed: start -->
-(old stale generated content — should get replaced)
+## Overview
+
+Auto-generated documentation index for **eval-claude-md-preserve**.
+
+- [Wiki documentation](wiki/index.md)
+
+## Build & Run
+
+See project-specific build instructions.
+
+## Service Dependencies
+
+See wiki for service dependency details.
+
+## Database References
+
+See wiki for database schema documentation.
 <!-- wiki-managed: end -->
```

## Verdict

PASS — the managed section DID change, confirming the tool ran and regenerated the content. The new managed content matches what `generateClaudeMd()` emits for a project whose `path.basename` is `eval-claude-md-preserve`, with a relative wiki path `wiki/index.md`.
