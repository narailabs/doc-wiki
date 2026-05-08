---
description: Scaffold wiki dirs + config
argument-hint: '[--path <wiki-root>] [--domain <domain>] [--name <wiki-name>]'
allowed-tools: Skill(doc-wiki)
---

Invoke the `doc-wiki` skill to run the `/doc-wiki:init` workflow with the user's arguments: $ARGUMENTS

Call `Skill(doc-wiki, "init $ARGUMENTS")`. The skill orchestrator reads `skills/doc-wiki/SKILL.md`, locates the `### /doc-wiki:init — Bootstrap a wiki` section, and executes that flow (creating `wiki/`, `raw/`, `graph/`, `audit/`, `log/`, `outputs/`, `.wiki-cache/`, `.wiki-ignore`, and a default `wiki.config.yaml`).

If `$ARGUMENTS` is empty, do NOT pre-prompt — invoke the skill anyway. The skill's `/doc-wiki:init` section infers a default path of `docs/<app-name-kebab-case>-wiki/` from the project's marker file (`package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `pom.xml`, ...) and asks the user to confirm or override via a single `AskUserQuestion` prompt. Arg collection lives in the skill so default-inference logic stays co-located with the rest of the orchestrator.
