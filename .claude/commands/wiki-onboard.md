---
description: Interactive onboarding — detect stack, ORM, DB, configure sources
argument-hint: '[wiki-root]'
allowed-tools: Skill(wiki)
---

Invoke the `wiki` skill to run the `/wiki-onboard` workflow with the user's arguments: $ARGUMENTS

Call `Skill(wiki, "onboard $ARGUMENTS")`. The skill orchestrator reads `.claude/skills/wiki/SKILL.md`, locates the `### /wiki-onboard — Interactive onboarding Q&A` section, and runs the six-phase onboarding flow (auto-detect language/framework, detect ORM via `wiki-orm-agent`, detect database via `wiki-db-agent`, Q&A for external services, choose autonomy mode, install hooks + scaffold).

If `$ARGUMENTS` is empty, default the wiki root to the current working directory and proceed interactively.
