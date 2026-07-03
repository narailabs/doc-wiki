# dev.to deep-dive — paste-ready

> Publish T+5 (the Friday after Show HN). Single canonical post — do *not* cross-publish to Medium / Substack / Hashnode. SEO dilution kills the long-tail traffic.

## Title

```
I built a living wiki for my coding agent, benchmarked it, and published the null
```

## Tags

```
ai, claude, opensource, testing
```

Limit 4 tags; pick those exact four. `testing` fits the benchmark-honesty angle better than `productivity`; `opensource` reads as "give the code to me."

## Cover image

A simple two-panel graphic: left panel a wiki page with an ER diagram ("what it makes"), right panel the benchmark table with the 57/92 vs 54/92 row circled ("what we measured"). 1000×420 px. Stored at `media/blog-cover-devto.png`. (The old red/green BEFORE/AFTER accuracy split-screen is retired — never use it.)

## Body

```markdown
# I built a living wiki for my coding agent, benchmarked it, and published the null

> tl;dr — I built `doc-wiki`, a Claude Code plugin that maintains a
> structured wiki over a codebase + its ecosystem (Jira / Confluence /
> GitHub / GitLab / Notion / Linear / DB schemas): per-topic
> architecture pages, ER diagrams derived from the actual ORM models,
> an auto-generated cross-service map, cited answers. Then I built a
> hardened SWE-bench-style benchmark to test the claim everyone
> (including me) wanted to make — "the wiki makes the agent fix more
> tickets autonomously" — and the answer was no: 92 ticket pairs,
> baseline 57 passed, wiki 54. I published the null in full instead of
> a favorable slice. This post is about both halves: what the wiki is
> actually for, and what the benchmark taught me about measuring
> context tools. Repo (Apache 2.0):
> [github.com/narailabs/doc-wiki](https://github.com/narailabs/doc-wiki).

## The shape of the problem

I'm not going to spend long here because every backend engineer reading this knows the shape of the problem. My codebase is 8 years old. The DB schema drifted from the ORM models three refactors ago. Half the answers about *why* something is the way it is are in Jira tickets from 2022. Another 40 services in the ecosystem nobody fully understands.

The model can't see what isn't in its context, and dumping the whole repo is impossible — and useless even when it fits, because raw source is the wrong shape of input for "should I refactor or write a new service here?"

## The pattern: LLM Wiki

On April 4, 2026, Andrej Karpathy posted a gist describing what he called the [LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) pattern: a maintained, compounding artifact of distilled knowledge that the LLM reads instead of re-deriving the same answers every turn. Karpathy pointed it at his personal notes; within two weeks there were dozens of implementations.

The thing that made the pattern contagious is that it solved a problem everyone already had. RAG over raw sources re-fetches and re-chunks every query, and the relevant signal drowns in boilerplate. A maintained wiki is shaped exactly the way the model wants to read.

## doc-wiki — the enterprise execution

`doc-wiki` is that pattern pointed at complex enterprise code — and it scales down fine to simple side-project repos, plus the root-of-microservices case where each service is a submodule and the wiki documents how the services relate to each other (service dependencies, client registry, queue registry, shared libraries — generated automatically when it detects more than one service). Two extensions matter:

1. **The wiki covers the ecosystem, not just the code.** The Jira tickets explaining *why* something was done that way, the Confluence page recording last quarter's postmortem, the actual database schema with the columns the ORM forgot about. doc-wiki ingests all of it through one planner (`gather()` from `narai-primitives`) into one structured wiki, with ER diagrams derived from your real ORM models (7 ORM families supported).

2. **The wiki is maintained.** Static documentation rots within months. `/doc-wiki:ingest --refresh` re-fetches and re-compiles changed sources. `/doc-wiki:lint` catches drift. Content-hash drift detection flags pages whose source code moved. The wiki survives refactors.

The mechanical part: doc-wiki is a Claude Code plugin shipping eight slash commands. The output is a structured markdown wiki at `docs/<app>-wiki/`. Claude Code reads it (via `CLAUDE.md` references) before touching code — and Codex, Cursor, Gemini, and Aider read the same wiki through their own convention files. Everything runs in your existing agent session. No SaaS, no telemetry.

## The benchmark, and why I'm publishing a null

The claim I wanted to make — the claim this entire category wants to make — is "wiki in context ⇒ agent fixes more tickets by itself." So I built the benchmark that would prove it: SWE-bench-style paired runs (same ticket, same model, same prompt, only delta is the wiki), container-isolated with an Anthropic-only egress firewall, sanitized ticket bodies, training-data contamination floors, pre-registered test calibration.

Four configurations. 92 valid ticket pairs across two OSS repos (vitest, Saleor). Result:

| | baseline | wiki |
|---|---|---|
| tickets passed | **57/92 (62%)** | **54/92 (59%)** |

No lift. One configuration even looked positive (+3 on Opus) until we traced the wins to backport-duplicate tickets the baseline had passed elsewhere in the same run — single-run variance, not signal. The genuinely hard tickets failed both arms on both models. Full data, per-run artifacts, and the regime analysis (ceiling effects on well-calibrated OSS tickets, floor effects on feature-sized schema tickets) are at [`benchmark/RESULTS.md`](https://github.com/narailabs/doc-wiki/blob/main/benchmark/RESULTS.md).

I could have shipped the +3 cell as the headline. You have seen tools do exactly that. The whole point of publishing the null is that you can trust the rest of this post.

## So what is it for?

The benchmark measures one narrow regime: an agent **alone** in a box with a **single OSS repo** and a well-written ticket. That regime turns out to be bimodal — the model either already solves the ticket without help, or the ticket is a feature-sized change no single-shot session solves with any context.

Where I actually work is neither. Ecosystem-heavy enterprise code, tickets whose context lives in Jira threads and DB schemas, and me in the loop: I read the cross-service map to scope the change, point the agent at the right wiki pages, catch the wrong turn at diff two instead of after the deploy. Used that way, my own fix rate went from ~10% to ~50% — one engineer's anecdote on a private codebase, in a regime the benchmark doesn't reach, and I label it that way everywhere.

The honest position: the human-plus-agent, enterprise, cross-service regime is unbenchmarked — by me or anyone. Until that changes, the artifact justifies itself on inspection. Generate the wiki on your repo and look at what it makes.

## How to try it

```sh
claude plugin install narailabs/doc-wiki
/doc-wiki:init               # scaffold + onboarding (stack, ORM, DB, services)
/doc-wiki:atlas --dry-run    # show cost estimate, no writes
/doc-wiki:atlas              # commit
/doc-wiki:query "How does authentication work in this repo?"
```

Five-minute walkthrough at [docs/getting-started.md](https://github.com/narailabs/doc-wiki/blob/main/docs/getting-started.md).

## What I'd most value

Three things, in order of effort:

1. **Try it on your real-world codebase** — complex enterprise monolith, microservices root, or simple side project. Tell me what the wiki gets right and wrong. GitHub issues are the right surface.
2. **Attack the benchmark.** The harness takes a repo config (`benchmark/repos/<id>.yaml`); if you think there's a regime where the wiki should show autonomous lift, define it and run it. I'll publish whatever it says.
3. **Name the category.** "LLM Wiki for enterprise code" is a working phrase. The dbt-style move (analytics engineering) is what compounds; the pattern names itself eventually.

Apache 2.0. Forever. Explicit no-relicense commitment in [`docs/manifesto.md`](https://github.com/narailabs/doc-wiki/blob/main/docs/manifesto.md). Built solo, no funding.

— [rfv](https://github.com/narailabs)
```

## Notes

- **Word count:** ~1100 words. dev.to's optimal range is 800–1500.
- **Code blocks formatted with triple-backtick + language hint.** dev.to's syntax highlighter is good; use it.
- **Crosslink count:** 6 internal links to the repo. Don't link to other dev.to posts — keeps reading attention.
- **Don't add a CTA banner at the top.** dev.to's audience downvotes hard-sell openings.
- **Comment cadence:** check the post every 2h for the first 24h. Reply to every comment within 30 min.
- **If a comment surfaces a real bug or feature request:** open the GitHub issue together in real-time. Comment back with the issue link.
- **Don't promote the post on your X/HN/Reddit channels.** It's a deep-dive for people who find it organically; surface promotion looks thirsty. Let dev.to's own algorithm + Google SEO carry it.
- **Re-share to dev.to's #ai newsletter** (auto-curates from top posts in the tag) by tagging accordingly.
- **Never claim an autonomous-accuracy lift.** The published benchmark is null; the only accuracy numbers allowed are the null (cited) and the ~10%→~50% anecdote (qualified: private codebase, human in the loop, unbenchmarked regime).
