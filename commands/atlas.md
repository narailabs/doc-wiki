---
description: Generate full application documentation
argument-hint: '[--facets <list>] [--scope <topic>] [--cross-service] [--no-cross-service] [--yes] [--dry-run] [--max-cost <usd>] [--since <duration>] [--validate-mode shallow|full] [--resume] [--wiki-root <path>]'
allowed-tools: Skill(doc-wiki)
---

Invoke the `doc-wiki` skill to run the `/doc-wiki:atlas` workflow with the user's arguments: $ARGUMENTS

Call `Skill(doc-wiki, "atlas $ARGUMENTS")`. The skill orchestrator reads `skills/doc-wiki/SKILL.md`, locates the `### /doc-wiki:atlas — Full application documentation` section, and runs the eight-phase pipeline (detect state, discover topics, confirm, estimate cost, validate existing, bootstrap/refresh, synthesize globals, finalize).

If `$ARGUMENTS` is empty, default to the comprehensive facet set (`architecture,data-model,environments,api,operations`) and run interactively with phase confirmations gated by the configured autonomy mode.
