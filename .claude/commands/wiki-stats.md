---
description: Token efficiency and cost metrics from the event log
argument-hint: '[--since 7d] [--wiki-root <path>] [--per-agent]'
allowed-tools: Skill(wiki)
---

Invoke the `wiki` skill to run the `/wiki-stats` workflow with the user's arguments: $ARGUMENTS

Call `Skill(wiki, "stats $ARGUMENTS")`. The skill orchestrator reads `.claude/skills/wiki/SKILL.md`, locates the `### /wiki-stats — Token efficiency and cost metrics` section, and runs `event_logger.ts stats` to show running averages, p50/p95 token-reduction ratios, total spend, and per-agent cost breakdown.

If `$ARGUMENTS` is empty, default to `--since 7d`.
