---
description: Bootstrap a wiki — scaffold directories and default config
argument-hint: '[--path <wiki-root>] [--domain <domain>] [--name <wiki-name>]'
allowed-tools: Skill(wiki)
---

Invoke the `wiki` skill to run the `/wiki-init` workflow with the user's arguments: $ARGUMENTS

Call `Skill(wiki, "init $ARGUMENTS")`. The skill orchestrator reads `.claude/skills/wiki/SKILL.md`, locates the `### /wiki-init — Bootstrap a wiki` section, and executes that flow (creating `wiki/`, `raw/`, `graph/`, `audit/`, `log/`, `outputs/`, `.wiki-cache/`, `.wiki-ignore`, and a default `wiki.config.yaml`).

If `$ARGUMENTS` is empty, ask the user to provide `--path`, `--domain`, and `--name` before invoking the skill.
