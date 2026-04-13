---
description: Quick targeted correction to a wiki page
argument-hint: '<page-path> <issue-description>'
allowed-tools: Skill(wiki)
---

Invoke the `wiki` skill to run the `/wiki-fix` workflow with the user's arguments: $ARGUMENTS

Call `Skill(wiki, "fix $ARGUMENTS")`. The skill orchestrator reads `.claude/skills/wiki/SKILL.md`, locates the `### /wiki-fix — Quick corrections` section, and runs the targeted correction flow (read the page, show diff of current vs proposed, apply if autonomy mode permits, log the event, and run post-op hooks for crosslink + tag-harmonize).

If `$ARGUMENTS` is empty, ask the user which page needs fixing and what the issue is.
