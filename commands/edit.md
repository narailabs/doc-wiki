---
description: Edit a wiki page — targeted change to a specific page
argument-hint: '<page-path> <change-description>'
allowed-tools: Skill(doc-wiki)
---

Invoke the `doc-wiki` skill to run the `/doc-wiki:edit` workflow with the user's arguments: $ARGUMENTS

Call `Skill(doc-wiki, "edit $ARGUMENTS")`. The skill orchestrator reads `skills/doc-wiki/SKILL.md`, locates the `### /doc-wiki:edit — Targeted page changes` section, and runs the page-modification flow (read the page, show diff of current vs proposed, apply if autonomy mode permits, log the event, and run post-op hooks for crosslink + tag-harmonize).

If `$ARGUMENTS` is empty, ask the user which page needs editing and what the change is.
