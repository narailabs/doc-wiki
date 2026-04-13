---
description: Promote an archived query answer to a permanent wiki page
argument-hint: '<query-output-file> [--topic <directory>]'
allowed-tools: Skill(wiki)
---

Invoke the `wiki` skill to run the `/wiki-promote` workflow with the user's arguments: $ARGUMENTS

Call `Skill(wiki, "promote $ARGUMENTS")`. The skill orchestrator reads `.claude/skills/wiki/SKILL.md`, locates the `### /wiki-promote — Query answer -> wiki page` section, and converts an archived query answer from `outputs/queries/` into a permanent wiki page (convert citations to relative markdown links, add frontmatter, place in the appropriate topic directory).

If `$ARGUMENTS` is empty, list recent files in `outputs/queries/` and ask the user which one to promote.
