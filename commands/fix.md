---
description: Fix a wiki page
argument-hint: '<page-path> <issue-description>'
allowed-tools: Skill(doc-wiki)
---

Invoke the `doc-wiki` skill to run the `/doc-wiki:fix` workflow with the user's arguments: $ARGUMENTS

Call `Skill(doc-wiki, "fix $ARGUMENTS")`. The skill orchestrator reads `skills/doc-wiki/SKILL.md`, locates the `### /doc-wiki:fix — Quick corrections` section, and runs the targeted correction flow (read the page, show diff of current vs proposed, apply if autonomy mode permits, log the event, and run post-op hooks for crosslink + tag-harmonize).

If `$ARGUMENTS` is empty, ask the user which page needs fixing and what the issue is.
