---
description: Bootstrap a wiki — scaffold, onboard, optionally chain atlas
argument-hint: '[--path <wiki-root>] [--domain <domain>] [--name <wiki-name>] [--no-atlas | --atlas]'
allowed-tools: Skill(doc-wiki)
---

Invoke the `doc-wiki` skill to run the `/doc-wiki:init` workflow with the user's arguments: $ARGUMENTS

Call `Skill(doc-wiki, "init $ARGUMENTS")`. The skill orchestrator reads `skills/doc-wiki/SKILL.md`, locates the `### /doc-wiki:init — Bootstrap a wiki` section, and executes the four-phase flow: (1) detect existing state, (2) scaffold the wiki directory if needed, (3) run the onboarding Q&A (language/framework detect, ORM via `wiki-orm-agent`, DB detection by inspecting local config files such as Docker Compose, `.env`, and ORM settings — plus optional `gather()` against the `db` connector for live schema introspection — followed by ecosystem services Q&A, autonomy choice, and hook install), (4) decide on atlas — if `--atlas` chain immediately; if `--no-atlas` stop; otherwise prompt the user.

If `$ARGUMENTS` is empty, do NOT pre-prompt — invoke the skill anyway. The skill's `/doc-wiki:init` section infers a default path of `docs/<app-name-kebab-case>-wiki/` from the project's marker file (`package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `pom.xml`, ...) and asks the user to confirm or override via a single `AskUserQuestion` prompt. Arg collection lives in the skill so default-inference logic stays co-located with the rest of the orchestrator.
