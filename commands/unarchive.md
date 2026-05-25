---
description: Restore an archived wiki page to its original location.
argument-hint: '<path-or-slug> [--target <wiki-relative-path>] [--yes]'
allowed-tools: Skill(doc-wiki)
---

Invoke the `doc-wiki` skill to run the `/doc-wiki:unarchive` workflow with the user's arguments: $ARGUMENTS

Call `Skill(doc-wiki, "unarchive $ARGUMENTS")`. The skill orchestrator reads `skills/doc-wiki/SKILL.md`, locates the `### /doc-wiki:unarchive — Restore an archived page` section, and runs the unarchive flow (move the page back from `wiki/_archive/` to its original or specified location, remove the `archived: true` frontmatter flag, restore inbound links, and log the event).

If `$ARGUMENTS` is empty, ask the user which archived page to restore.
