# Cold email — Simon Willison

> The single most important pre-launch email. Simon's coverage of [Jesse Vincent's Superpowers plugin on October 10, 2025](https://simonwillison.net/2025/Oct/10/superpowers/) is the documented launch event that put Superpowers on Anthropic's official-marketplace track within ~90 days. We are copying that playbook.

## When

T-10 to T-7 (a week to ~10 days before Show HN). Earlier than the rest of the cold-email circuit because Simon is the credibility-signal source for everyone downstream.

## To

```
swillison@gmail.com
```

(Public on [simonwillison.net/about/](https://simonwillison.net/about/) — verified at time of writing.)

## Subject (≤55 chars)

```
The enterprise lane of your LLM Wiki pattern
```

## Body — paste-ready

```
Hi Simon,

I built doc-wiki, an open-source Claude Code plugin that implements
the LLM Wiki pattern Andrej Karpathy named in April — but pointed at
complex enterprise codebases instead of personal notes (it works fine
on small repos and especially shines on root-of-microservices
submodule layouts, where it documents how the services relate). It
ingests code + Jira + Confluence + GitHub + Notion + AWS/GCP + ORM/DB
schemas through one planner and maintains a structured wiki the agent
reads before touching code.

The part I suspect you'll find most interesting: I built a hardened
SWE-bench-style benchmark (container-isolated, egress firewall,
sanitized tickets, contamination floors) to test whether the wiki
lifts the agent's fully-autonomous ticket-fix rate — and it doesn't.
Four configurations, 92 valid ticket pairs on vitest and Saleor:
baseline 57/92, wiki 54/92. I'm publishing the null in full at
benchmark/RESULTS.md, per-run artifacts included, with the regime
analysis of why (ceiling effects, floor effects, one spurious +3 from
backport-duplicate variance). My own ~10%→~50% experience on a
private 500k-LOC enterprise codebase is human-in-the-loop and labeled
as an anecdote everywhere — the honest position is that the regime
where I believe the value lives is unbenchmarked, by me or anyone.

Two reasons I'm writing.

(1) Early-access offer: I'd value your hands on the artifact before
the public launch next week. The repo (Apache 2.0):
github.com/narailabs/doc-wiki. A 5-minute walkthrough: /doc-wiki:init,
then /doc-wiki:atlas --dry-run on any codebase you have open. The
manifesto explains the framing in more depth than the README:
github.com/narailabs/doc-wiki/blob/main/docs/manifesto.md.

(2) The methodology is the part I want stress-tested most. The harness
in benchmark/ takes a repo config (benchmark/repos/<id>.yaml: mine →
calibrate → run both arms → grade); if you wanted to point it at (say)
datasette or llm, I'd be genuinely curious whether the null holds
there too — and I'll publish whatever it says either way.

Not asking for coverage — only for honest reactions and (if the
methodology is sound) a poke at it on a repo you know well. Apache 2.0
forever, explicit no-relicense commitment in the manifesto.

— rfv (github.com/narailabs)
```

## Notes

- **What you're explicitly NOT asking for:** a blog post. Don't say "would you cover it" or "consider blogging about it." Simon writes about things he finds genuinely interesting; the ask is for hands-on.
- **What you ARE offering:** early access (a flattering ask), a re-run on a repo *he* picks (gives him a content angle if he wants one), and the manifesto as a deep-dive if curiosity is sparked.
- **The Karpathy framing is non-negotiable.** Simon has written about LLM Wiki pattern adopters. The fact that doc-wiki is an explicit enterprise execution of that pattern is the *one* reason this email gets read.
- **Hit-rate honesty:** ~10–20% chance he responds; ~5–10% chance he writes about it. Even no-response is fine; the email itself isn't lost — it establishes a paper trail.
- **Don't send the same email to other Simon-tier targets** (Karpathy himself, Jeff Atwood, etc.). Each cold-pitch has to be specific to the recipient.
- **If he responds positively:** offer a 30-minute walkthrough call within the same week. Move fast.
- **If he asks "can I see the personal codebase numbers":** politely no (private codebase, NDA risk). Point at the published OSS null instead — the transparency IS the pitch to Simon. He'll understand.
- **Never claim an autonomous-accuracy lift.** The published benchmark is null; the only accuracy numbers allowed are the null (cited) and the ~10%→~50% anecdote (qualified: private, human-in-the-loop, unbenchmarked regime).
- **If he writes a blog post:** thank him in the post comments (not by email). Don't share his post in your launch artifacts; let it travel organically.
