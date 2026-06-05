# Cold email — Alex Albert (Anthropic DevRel)

> **Send only after these are in place:** (a) community-marketplace listing live; (b) Simon Willison post live (or thoughtful no-response from him); (c) ≥1k GitHub stars; (d) at least one external contributor PR merged. Without those signals, this email is a cold ask. With them, it's the Superpowers-playbook pitch verbatim — same playbook that put Jesse Vincent's plugin on the official-marketplace track within 90 days.

## When

T+30 to T+60, after the conditions above land. Earlier is too soon; later loses the launch-momentum signal.

## To

```
alex@anthropic.com
```

(Public on his various conference bios and on [x.com/alexalbert__](https://x.com/alexalbert__) — verified at time of writing. If he's moved roles, check current contact via Anthropic press page.)

## Subject (≤55 chars)

```
Plugin spotlight pitch — doc-wiki on Verified track
```

## Body — paste-ready (assumes Simon Willison endorsement landed)

```
Hi Alex,

I built doc-wiki, the Claude Code plugin currently in the community
marketplace at <COMMUNITY_MARKETPLACE_URL>. Sketch:

- Feeds Claude an ecosystem-aware wiki over code + Jira + Confluence +
  GitHub + Notion + AWS/GCP + ORM/DB schemas.
- On the author's enterprise codebase: ~10% → ~80% autonomous ticket-fix
  accuracy. Reproducible benchmark on Django / Cal.com / Mastodon in
  benchmark/.
- Apache 2.0 forever, explicit no-relicense commitment, signed releases.

Three signals since launch (date M D):

(1) Simon Willison covered it on M D (<URL>) — the Superpowers-style
endorsement.
(2) <N> GitHub stars / <K> weekly active installs since Show HN at
news.ycombinator.com/item?id=<HN_ID>.
(3) <M> external contributors with merged PRs.

Two things I'd value Anthropic's time on:

(1) Verified-badge consideration. Plugin is in the community
marketplace; I'd like to apply for Verified once the community-tier
metrics warrant. Happy to walk through the security posture (everything
runs in the user's Claude Code session, credentials never traverse the
LLM context, read-only connectors with a policy gate) and the
governance posture (Apache 2.0 forever, public commitment, bus-factor
roadmap to co-maintainers by Q4).

(2) Engineering-blog spotlight. The compounding-artifact / LLM Wiki
pattern feels like the kind of thing Anthropic's blog has covered for
other plugins (Superpowers, Atomic Agents). If a co-authored or
spotlight post would be a fit, I'd be glad to write a draft for review
that covers (a) what doc-wiki is, (b) the reproducible benchmark
methodology, (c) the standards-track posture. Or — if the timing's off
— Code with Claude 2027 lightning-talk consideration.

No pressure on either ask. If neither is a fit right now, even a quick
"keep iterating, come back at X stars" would help me calibrate.

Repo: github.com/narailabs/doc-wiki
Manifesto: github.com/narailabs/doc-wiki/blob/main/docs/manifesto.md
Benchmark: github.com/narailabs/doc-wiki/tree/main/benchmark
Governance: github.com/narailabs/doc-wiki/blob/main/docs/governance.md

— rfv (github.com/narailabs)
```

## Body — alt version (Simon Willison didn't bite)

If Simon doesn't respond or doesn't post by T+30, drop the Willison paragraph and substitute with whatever Tier-A signal *did* land — Pragmatic Engineer mention, big-co eng blog quote, named contributor org, conference talk acceptance. Don't send this email without a credible signal.

If no Tier-A signal landed by T+60, postpone the email. Land more signal first.

## Notes

- **The Superpowers comparison is implicit, not explicit.** Don't write "we're like Superpowers" — Alex will read that as derivative. Write the same shape (endorsement + traction + Apache 2.0 + governance posture + spotlight ask) and let him connect the pattern.
- **The two-ask structure (Verified + spotlight) is intentional.** It gives Alex a smaller (Verified consideration) and a larger (blog spotlight) thing he can approve independently. Single-ask emails get ignored more often.
- **Hit-rate:** ~25% response rate if all the pre-conditions are met; ~5% response rate if you send it without them. Pre-conditions matter.
- **What you do if he responds positively:** move within 24h. Anthropic DevRel calendars fill fast. Have a draft engineering-blog post ready *before* you send this email so you can attach it immediately if he asks.
- **What you do if he says "not yet, come back at X stars":** thank him sincerely, do the work, come back when X is met. Don't argue.
- **If he ignores it:** silence is a "not yet, keep building." Don't follow up before 30 days.
- **Don't CC Cat Wu or Boris Cherny on this email.** Alex owns DevRel and will route internally if relevant. CC-ing reads as ladder-climbing.

## Pre-flight checklist (run through before sending)

- [ ] Community marketplace listing live and stable for ≥14 days
- [ ] Simon Willison post live OR equivalent Tier-A signal in hand
- [ ] ≥1000 GitHub stars
- [ ] ≥1 merged external contributor PR
- [ ] benchmark/results/RESULTS.md populated with real numbers
- [ ] docs/governance.md signed off as accurate (esp. the bus-factor co-maintainer line — do not promise what you can't deliver)
- [ ] Draft engineering-blog post (~2000 words) sitting in a private gist, ready to share if asked
