# X / Twitter launch thread — paste-ready

> Post Tuesday 8:30am PT, same minute as the Show HN. Pin the first tweet.

## Tweet 1 — pinned, attach the 60-sec video

```
I open-sourced doc-wiki today.

It feeds Claude Code a maintained wiki of your code + Jira + Confluence
+ GitHub + Notion + DB schemas.

The wiki is the product. The benchmark is public — including where it
lost. Apache 2.0 forever. 🧵

[VIDEO — 60-sec demo: atlas → wiki → ER diagrams → cross-service map → cited answers, from media/demo.mp4]
```

**Counts:** ~240 chars / 280 budget. The thread emoji at the end signals "more below" to the algorithm.

## Tweet 2 — the why

```
Most "Claude Code makes me 10× more productive" stories are on clean
OSS code. The codebase you actually work in is 8 years old, glued to
Jira tickets nobody reads, a DB schema that drifted from the ORM 3
refactors ago.

That's the case I built doc-wiki for.
```

## Tweet 3 — the pattern

```
The pattern: Karpathy's LLM Wiki
(https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)
but pointed at complex enterprise code instead of personal notes
(scales down to small repos, scales up to root-of-microservices
submodule layouts).

A maintained, compounding artifact the agent reads instead of
re-deriving everything from raw sources every turn.
```

## Tweet 4 — the 10 commands

```
Ten slash commands cover the lifecycle:
/doc-wiki:init      → scaffold
/doc-wiki:onboard   → detect stack, ORM, DB, services
/doc-wiki:atlas     → document the whole codebase
/doc-wiki:ingest    → add a source (file/URL/ticket)
/doc-wiki:query     → cited synthesis
/doc-wiki:promote   → query answer → permanent page
/doc-wiki:refresh   → keep current
/doc-wiki:lint, :fix, :stats
```

## Tweet 5 — the benchmark

```
We benchmarked whether the wiki makes Claude Code fix more tickets
fully autonomously: 92 paired runs on OSS repos, four configurations —
no measured lift. That null is published in full, re-runnable from a
fresh checkout.

What we ship is the artifact: the map, the diagrams, the cited
answers. Inspect it and decide.
github.com/narailabs/doc-wiki/tree/main/benchmark
```

## Tweet 6 — the license

```
Apache 2.0. Forever.

No relicensing, no rug-pull, no "doc-wiki Pro" with the good parts
behind a paywall. Explicit no-relicense commitment in docs/governance.md.

The Terraform→OpenTofu and Redis→Valkey lessons cost the ecosystem too
much already.
```

## Tweet 7 — call to action

```
Install:
claude plugin install narailabs/doc-wiki

5-min walkthrough:
github.com/narailabs/doc-wiki/blob/main/docs/getting-started.md

Manifesto (why this exists, what "LLM Wiki for enterprise code"
means, the standard-track argument):
github.com/narailabs/doc-wiki/blob/main/docs/manifesto.md

Built it solo. Looking for users + feedback + arguments.
```

---

## Tagging strategy

**Tweet 1 (pinned)** — no tags. Tags in a pinned tweet hurt reach because the algorithm reads them as a thread-of-replies signal.

**Tweet 6 or 7** — tag `@bcherny @alexalbert__ @ClaudeDevs` *once*, naturally in the body (not as an `.@` at the start). Don't tag Karpathy, swyx, or Simon Willison in-thread — DM them separately. Tagging celebrities in-thread reads as spam.

**Subsequent threads (T+1 to T+7)** — use the hashtag `#claudecode` sparingly. It's a real tag but oversaturated.

## Engagement plan

- Reply to every reply for 24h.
- For replies that are questions: thank → answer crisply → link to the right doc.
- For replies that are criticism: thank → engage genuinely → don't get defensive. The audience watches.
- For replies that are spam ("nice work bro, check out my product"): mute, don't engage.
- For replies that are RTs from named accounts (Boris, swyx, Karpathy, Theo): quote-reply with a single thoughtful tweet that adds new info. Don't gush.

## Post-thread cadence (T+8 onward)

One tweet every 2 days. Three rotation types:
1. **User story** — "X engineer just used doc-wiki on Y codebase, here's what changed."
2. **Feature drop** — "Today shipped Z; the why."
3. **Karpathy LLM Wiki community-implementation roundup** — quote-tweet someone in the wider LLM Wiki ecosystem with a thoughtful adjacency to doc-wiki.

Don't tweet-bait. Don't ratio-bait. Don't reply-guy on @bcherny tweets unless you have something genuinely useful to add.
