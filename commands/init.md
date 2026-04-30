---
description: Scaffold wiki dirs + config
argument-hint: '[--path <wiki-root>] [--domain <domain>] [--name <wiki-name>]'
allowed-tools: Skill(doc-wiki)
---

Invoke the `doc-wiki` skill to run the `/doc-wiki:init` workflow with the user's arguments: $ARGUMENTS

Call `Skill(doc-wiki, "init $ARGUMENTS")`. The skill orchestrator reads `skills/doc-wiki/SKILL.md`, locates the `### /doc-wiki:init — Bootstrap a wiki` section, and executes that flow (creating `wiki/`, `raw/`, `graph/`, `audit/`, `log/`, `outputs/`, `.wiki-cache/`, `.wiki-ignore`, and a default `wiki.config.yaml`).

If `$ARGUMENTS` is empty, ask the user to provide `--path`, `--domain`, and `--name` before invoking the skill.
