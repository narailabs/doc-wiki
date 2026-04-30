---
description: Token / cost metrics
argument-hint: '[--since 7d] [--wiki-root <path>] [--per-agent]'
allowed-tools: Skill(doc-wiki)
---

Invoke the `doc-wiki` skill to run the `/doc-wiki:stats` workflow with the user's arguments: $ARGUMENTS

Call `Skill(doc-wiki, "stats $ARGUMENTS")`. The skill orchestrator reads `skills/doc-wiki/SKILL.md`, locates the `### /doc-wiki:stats — Token efficiency and cost metrics` section, and runs `event_logger.ts stats` to show running averages, p50/p95 token-reduction ratios, total spend, and per-agent cost breakdown.

If `$ARGUMENTS` is empty, default to `--since 7d`.
