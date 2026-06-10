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

On my own enterprise codebase (private; 500k LOC, 8 years old, glued to
Jira / Confluence / 4 databases) autonomous ticket-fix accuracy went
from ~10% to ~80% after wiring it up. I'm shipping a reproducible
benchmark in the repo against Django, Cal.com, and Mastodon (SWE-bench-
style binary pass/fail on the specific test the fix PR added).

Two reasons I'm writing.

(1) Early-access offer: I'd value your hands on it before the public
launch next week. The repo (Apache 2.0): github.com/narailabs/doc-wiki.
A 5-minute walkthrough: /doc-wiki:init, /doc-wiki:onboard, /doc-wiki:atlas
--dry-run on any codebase you have open. The manifesto explains the
framing in more depth than the README:
github.com/narailabs/doc-wiki/blob/main/docs/manifesto.md.

(2) If you wanted to re-run the benchmark on a codebase of your choosing,
the harness in benchmark/ accepts arbitrary repos via repos.yaml. I'd be
genuinely curious whether the doc-wiki delta on (say) datasette or
llm holds, and the methodology is the part I want stress-tested most.

Not asking for coverage — only for honest reactions and (if the
methodology is sound) a re-run on a repo you know well. Apache 2.0
forever, explicit no-relicense commitment in docs/governance.md.

— rfv (github.com/narailabs)
```

## Notes

- **What you're explicitly NOT asking for:** a blog post. Don't say "would you cover it" or "consider blogging about it." Simon writes about things he finds genuinely interesting; the ask is for hands-on.
- **What you ARE offering:** early access (a flattering ask), a re-run on a repo *he* picks (gives him a content angle if he wants one), and the manifesto as a deep-dive if curiosity is sparked.
- **The Karpathy framing is non-negotiable.** Simon has written about LLM Wiki pattern adopters. The fact that doc-wiki is an explicit enterprise execution of that pattern is the *one* reason this email gets read.
- **Hit-rate honesty:** ~10–20% chance he responds; ~5–10% chance he writes about it. Even no-response is fine; the email itself isn't lost — it establishes a paper trail.
- **Don't send the same email to other Simon-tier targets** (Karpathy himself, Jeff Atwood, etc.). Each cold-pitch has to be specific to the recipient.
- **If he responds positively:** offer a 30-minute walkthrough call within the same week. Move fast.
- **If he asks "can I see the personal codebase numbers":** politely no (private codebase, NDA risk). Offer the OSS benchmark instead. He'll understand.
- **If he writes a blog post:** thank him in the post comments (not by email). Don't share his post in your launch artifacts; let it travel organically.
