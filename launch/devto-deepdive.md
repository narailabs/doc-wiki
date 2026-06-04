# dev.to deep-dive — paste-ready

> Publish T+5 (the Friday after Show HN). Single canonical post — do *not* cross-publish to Medium / Substack / Hashnode. SEO dilution kills the long-tail traffic.

## Title

```
How I got 10× ticket-fix accuracy from Claude Code by building a living wiki for my enterprise codebase
```

## Tags

```
ai, claude, opensource, productivity
```

Limit 4 tags; pick those exact four. `productivity` reads to dev.to's algorithm as "ICs sharing what works"; `opensource` reads as "give the code to me."

## Cover image

A simple split-screen graphic: "BEFORE" (red, "~10% ticket-fix") / "AFTER" (green, "~80% ticket-fix"). 1000×420 px. Stored at `media/blog-cover-devto.png`.

## Body

```markdown
# How I got 10× ticket-fix accuracy from Claude Code by building a living wiki for my enterprise codebase

> tl;dr — Claude Code is great on clean small codebases. On the
> 500k-LOC 8-year-old enterprise monolith I actually work in, it fixes
> ~10% of tickets autonomously and quietly breaks things on the other
> 90%. I built a Claude Code plugin called `doc-wiki` that maintains a
> structured wiki over the codebase + the ecosystem (Jira / Confluence
> / GitHub / Notion / DB schemas), and feeds the wiki to Claude as
> context. Same model, same prompt, same Claude Code session —
> autonomous ticket-fix accuracy on my codebase jumped to ~80%.
> Apache 2.0 forever, reproducible benchmark in the repo against three
> OSS codebases (Django / Cal.com / Mastodon). Repo:
> [github.com/narailabs/doc-wiki](https://github.com/narailabs/doc-wiki).

## The shape of the problem

I'm not going to spend long here because every backend engineer reading this knows the shape of the problem. My codebase is 8 years old. The DB schema drifted from the ORM models three refactors ago. Half the answers about *why* something is the way it is are in Jira tickets from 2022. Another 40 services in the ecosystem nobody fully understands.

When I let Claude Code rip on a real ticket, it confidently writes a plausible-looking diff that breaks production maybe 90% of the time. Not because the model is bad — Claude Opus 4.7 is genuinely great — but because the model can't see what isn't in its context, and what isn't in its context is everything that matters.

## The pattern: LLM Wiki

On April 4, 2026, Andrej Karpathy posted a gist describing what he called the [LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) pattern: a maintained, compounding artifact of distilled knowledge that the LLM reads instead of re-deriving the same answers every turn. Karpathy pointed it at his personal notes; within two weeks there were dozens of implementations.

The thing that made the pattern contagious is that it solved a problem everyone already had. RAG over raw sources sucks — the model spends most of the context budget reading boilerplate, and the relevant signal is buried. A maintained wiki is shaped exactly the way the model wants to read.

## doc-wiki — the enterprise execution

`doc-wiki` is that pattern pointed at messy enterprise code. Two extensions matter:

1. **The wiki covers the ecosystem, not just the code.** Code alone isn't enough — the Jira tickets explaining *why* something was done that way, the Confluence page recording the postmortem of last quarter's outage, the actual database schema with the columns the ORM forgot about, the runbook for the deploy pipeline. doc-wiki ingests all of it through one planner (`gather()` from `narai-primitives`) into one structured wiki.

2. **The wiki is maintained.** Static documentation rots within months. `/doc-wiki:refresh` re-fetches and re-compiles changed sources. `/doc-wiki:lint` catches drift. Content-hash drift detection flags pages whose source code moved. The wiki survives refactors.

The mechanical part: doc-wiki is a Claude Code plugin shipping ten slash commands. The output is a structured markdown wiki at `docs/<app>-wiki/`. Claude Code reads it (via `CLAUDE.md` references) before touching code. Everything runs in your existing Claude Code session.

## The 10% → 80% number

On my private codebase: autonomous ticket-fix rate ~10% baseline → ~80% with doc-wiki. Anecdotal, explicitly.

The reproducible part is in [`benchmark/`](https://github.com/narailabs/doc-wiki/tree/main/benchmark) of the repo. Three codebases (Django, Cal.com, Mastodon), real closed issues from the last 18 months, with the specific test the fix PR added as the success criterion. SWE-bench-style binary pass/fail. No LLM-judge.

The OSS delta is smaller than my personal-codebase delta because open-source codebases are already cleaner than median enterprise code, so the baseline is higher and the doc-wiki delta is smaller. Re-run with your own codebase to see your number.

## How to try it

```sh
claude plugin install narailabs/doc-wiki
/doc-wiki:init
/doc-wiki:onboard
/doc-wiki:atlas --dry-run    # show cost estimate, no writes
/doc-wiki:atlas              # commit
/doc-wiki:query "How does authentication work in this repo?"
```

Five-minute walkthrough at [docs/getting-started.md](https://github.com/narailabs/doc-wiki/blob/main/docs/getting-started.md).

## What I'd most value

Three things, in order of effort:

1. **Try it on your messy codebase.** Tell me what worked / didn't. GitHub issues are the right surface.
2. **Re-run the benchmark.** Swap the three repos in `repos.yaml` for whatever codebase you want to argue about. Publish your numbers if you disagree with mine.
3. **Name the category.** "AI-readable wiki for messy code" is a working phrase. The dbt-style move (analytics engineering) is what compounds; the pattern names itself eventually.

Apache 2.0. Forever. Explicit no-relicense commitment in [`docs/governance.md`](https://github.com/narailabs/doc-wiki/blob/main/docs/governance.md). Built solo, no funding.

— [rfv](https://github.com/narailabs)
```

## Notes

- **Word count:** ~880 words. dev.to's optimal range is 800–1500.
- **Code blocks formatted with triple-backtick + language hint.** dev.to's syntax highlighter is good; use it.
- **Crosslink count:** 6 internal links to the repo. Don't link to other dev.to posts — keeps reading attention.
- **Don't add a CTA banner at the top.** dev.to's audience downvotes hard-sell openings.
- **Comment cadence:** check the post every 2h for the first 24h. Reply to every comment within 30 min.
- **If a comment surfaces a real bug or feature request:** open the GitHub issue together in real-time. Comment back with the issue link.
- **Don't promote the post on your X/HN/Reddit channels.** It's a deep-dive for people who find it organically; surface promotion looks thirsty. Let dev.to's own algorithm + Google SEO carry it.
- **Re-share to dev.to's #ai newsletter** (auto-curates from top posts in the tag) by tagging accordingly.
