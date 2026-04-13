---
description: Health check and auto-heal (broken links, orphans, drift)
argument-hint: '[--wiki-root <path>] [--fix] [--check <name>]'
allowed-tools: Skill(wiki)
---

Invoke the `wiki` skill to run the `/wiki-lint` workflow with the user's arguments: $ARGUMENTS

Call `Skill(wiki, "lint $ARGUMENTS")`. The skill orchestrator reads `.claude/skills/wiki/SKILL.md`, locates the `### /wiki-lint — Health check + auto-heal` section, runs `lint_checks.ts` for structural issues (broken links, missing frontmatter, orphans, isolated nodes, code-ref drift, provenance completeness, Mermaid syntax, index coverage, summaries sync, ORM mapping freshness, thin clusters), then performs LLM-driven checks for factual contradictions, stale content, terminology consistency, and missing coverage. Applies auto-fixes per the configured autonomy mode.

If `$ARGUMENTS` is empty, default the wiki root to the current working directory.
