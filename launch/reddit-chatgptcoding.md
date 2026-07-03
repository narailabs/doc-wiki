# r/ChatGPTCoding cross-post

> T+2 (two days after Show HN). Different framing from the r/ClaudeAI post — broader, model-agnostic, less Claude-specific. The r/ChatGPTCoding audience is multi-model; lead with the pattern (LLM Wiki) not the brand (Claude Code).

## Title

```
Open-sourced an "LLM Wiki for complex enterprise codebases" — works on Claude Code, would love feedback on adapting to Codex/Cursor/Aider
```

## Body

```
The pattern: Andrej Karpathy named "LLM Wiki" in April — a maintained,
compounding artifact the agent reads instead of re-deriving every
answer from raw sources. He pointed it at his personal notes; I built
the enterprise-codebase version.

doc-wiki ingests code + Jira + Confluence + GitHub + GitLab + Notion +
Linear + AWS/GCP + ORM/DB schemas, builds a structured wiki (ER
diagrams from your real ORM models, an auto-generated cross-service
map), and feeds it to your coding agent as context.

Numbers, honestly: I benchmarked whether the wiki lifts fully-
autonomous ticket-fix rate (92 ticket pairs, SWE-bench-style) — it
doesn't, and the full null is published in the repo at
benchmark/RESULTS.md. Where it earns its keep for me is human-in-the-
loop on ecosystem-heavy enterprise code (my own anecdotal fix rate:
~10% → ~50%, private codebase, labeled as anecdote).

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
