# r/ChatGPTCoding cross-post

> T+2 (two days after Show HN). Different framing from the r/ClaudeAI post — broader, model-agnostic, less Claude-specific. The r/ChatGPTCoding audience is multi-model; lead with the pattern (LLM Wiki) not the brand (Claude Code).

## Title

```
Open-sourced an "LLM Wiki for messy enterprise codebases" — works on Claude Code, would love feedback on adapting to Codex/Cursor/Aider
```

## Body

```
The pattern: Andrej Karpathy named "LLM Wiki" in April — a maintained,
compounding artifact the agent reads instead of re-deriving every
answer from raw sources. He pointed it at his personal notes; I built
the enterprise-codebase version.

doc-wiki ingests code + Jira + Confluence + GitHub + Notion + AWS/GCP
+ ORM/DB schemas, builds a structured wiki, and feeds it to your
coding agent as context. On my own (private, 500k LOC, 8-year-old)
enterprise codebase, autonomous ticket-fix accuracy went from ~10% to
~80%.

Caveat: today it ships as a Claude Code plugin and the slash commands
are Claude Code. The underlying skill works on Codex / Gemini / Cursor /
Aider via wrappers shipped at the repo root (AGENTS.md, GEMINI.md,
.cursor/rules/doc-wiki.mdc, .aider/conventions.md) — but I've tested
Claude Code most. The wiki output itself is plain markdown that any
agent can read.

Looking for: anyone running Codex or Cursor heavily who'd be willing
to run /doc-wiki:atlas --dry-run on a non-trivial codebase and tell
me where the multi-platform wrappers fall short. I want to fix that
before this becomes Claude-Code-only de-facto.

Repo (Apache 2.0): github.com/narailabs/doc-wiki
Benchmark: github.com/narailabs/doc-wiki/tree/main/benchmark
```

## Notes

- **Frame as model-agnostic.** The r/ChatGPTCoding crowd self-identifies as multi-model; emphasizing Claude Code alienates them.
- **Make the cross-platform ask real.** If anyone responds saying "tried it on Cursor, X broke," follow up within 24h. These responses become the contributor pool for the cross-platform fixes.
- **Don't link the Show HN.** The cross-sub link looks like brigading. Link only the repo and benchmark.
- **Posting time:** weekday morning ET, same as r/ClaudeAI.
- **If a mod flags as off-topic:** the subreddit's about "AI coding tools across models" — doc-wiki is on-topic. Message mods politely if needed.
