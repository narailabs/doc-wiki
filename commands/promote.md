---
description: Promote query answer
argument-hint: '<query-output-file> [--topic <directory>]'
allowed-tools: Skill(doc-wiki)
---

Invoke the `doc-wiki` skill to run the `/doc-wiki:promote` workflow with the user's arguments: $ARGUMENTS

Call `Skill(doc-wiki, "promote $ARGUMENTS")`. The skill orchestrator reads `skills/doc-wiki/SKILL.md`, locates the `### /doc-wiki:promote — Query answer -> wiki page` section, and converts an archived query answer from `outputs/queries/` into a permanent wiki page (convert citations to relative markdown links, add frontmatter, place in the appropriate topic directory).

If `$ARGUMENTS` is empty, list recent files in `outputs/queries/` and ask the user which one to promote.
