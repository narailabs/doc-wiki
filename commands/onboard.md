---
description: Interactive ecosystem onboarding
argument-hint: '[wiki-root]'
allowed-tools: Skill(doc-wiki)
---

Invoke the `doc-wiki` skill to run the `/doc-wiki:onboard` workflow with the user's arguments: $ARGUMENTS

Call `Skill(doc-wiki, "onboard $ARGUMENTS")`. The skill orchestrator reads `skills/doc-wiki/SKILL.md`, locates the `### /doc-wiki:onboard — Interactive onboarding Q&A` section, and runs the six-phase onboarding flow (auto-detect language/framework, detect ORM via `wiki-orm-agent`, detect database via `wiki-db-agent`, Q&A for external services, choose autonomy mode, install hooks + scaffold).

If `$ARGUMENTS` is empty, default the wiki root to the current working directory and proceed interactively.
