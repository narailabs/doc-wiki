# Cold email — Gergely Orosz (The Pragmatic Engineer)

> Fire T+3 to T+5 (the post-launch week). Gergely just covered OpenCode (newsletter.pragmaticengineer.com/p/opencode, May 27, 2026) — the angle is "the wiki layer that ecosystem is missing." His March 2026 AI tooling survey defines what "standard" means in this category; one mention reaches ~700K developers.

## When

T+3 to T+5. After the Show HN cools but before the launch wave fades. Send earlier than this and you have no traction to point to; send later than this and the news is stale.

## To

```
gergely@pragmaticengineer.com
```

(Public on [pragmaticengineer.com/about/](https://newsletter.pragmaticengineer.com/about) — verified at time of writing.)

## Subject (≤55 chars)

```
The wiki layer OpenCode/Cline don't have
```

## Body — paste-ready

```
Hi Gergely,

Your OpenCode deep-dive last week landed at the right moment for me —
I just open-sourced doc-wiki, a Claude Code plugin that does the
ecosystem-aware wiki layer the OpenCode / Cline / Continue.dev set
of model-routing agents don't have.

It feeds Claude (or any agent that can read CLAUDE.md) a maintained
wiki over code + Jira + Confluence + GitHub + GitLab + Notion + Linear
+ AWS/GCP + ORM/DB schemas: ER diagrams from the real ORM models, an
auto-generated cross-service map, cited answers.

The angle you might actually find newsworthy: I benchmarked my own
headline claim — does the wiki lift fully-autonomous ticket-fix
accuracy? — with a hardened SWE-bench-style harness (92 ticket pairs,
container-isolated, egress firewall) and the answer was no (baseline
57/92, wiki 54/92). I published the null in full at
benchmark/RESULTS.md rather than shipping a favorable slice. My own
~10%→~50% experience on a private 500k-LOC enterprise codebase is
human-in-the-loop and labeled anecdote everywhere; the regime where I
believe the value lives is unbenchmarked, by me or anyone.

Three more things worth a look:

(1) The ecosystem-integration story. The dominant Claude Code plugin
narrative is "skills/prompts/hooks" — Superpowers, Karpathy CLAUDE.md,
compound-engineering. doc-wiki is the first plugin treating Claude Code
as a *consumer* of structured external knowledge (Jira/Confluence/DB),
not just a smarter prompt loop. That feels like the next category boundary
in your March 2026 AI tooling map.

(2) The standards-track posture. Apache 2.0 forever, explicit no-
relicense commitment, signed-release attestations. After Terraform→
OpenTofu and Redis→Valkey, enterprise teams now check for this language.
I'd argue it's the new SOC2-equivalent for OSS dev tools.

(3) The "complex enterprise codebase" wedge — including the root-of-
microservices submodule case, where the wiki documents how the
services relate to each other (works on small codebases too, but the
gap is largest at enterprise scale). Your survey shows Claude Code
adoption is hockey-sticking inside large engineering orgs (Stripe at
1370 engineers, Mercado Libre's 90% autonomous target). Those orgs
hit the same context-bottleneck wall I did. doc-wiki is the early
artifact for that.

Show HN landed Tuesday: news.ycombinator.com/item?id=<YOUR_HN_ID>
Repo (Apache 2.0): github.com/narailabs/doc-wiki
Manifesto: github.com/narailabs/doc-wiki/blob/main/docs/manifesto.md
Benchmark (null, published in full): github.com/narailabs/doc-wiki/blob/main/benchmark/RESULTS.md

Not pitching coverage. Pitching whether the angle is worth a paragraph
in your next AI-tooling roundup, or a Q&A if you'd find it useful for
the audience.

— rfv (github.com/narailabs)
```

## Notes

- **The OpenCode hook is doing the heavy lifting.** Gergely reads dozens of cold pitches a week. The one detail that makes him read on is showing you read his last post and have a non-derivative observation about it.
- **The "newsworthy" framing isn't accidental.** Gergely is a journalist by trade. Pitches that look like ideas-for-coverage land better than pitches that look like asks-for-coverage.
- **Hit-rate:** ~15% chance he responds. If he does, he'll either ask for a deeper write-up he can include, or invite you onto his podcast format. Both are wins.
- **Don't follow up if no response within 14 days.** Either the angle didn't resonate, or his queue is overflowing. Follow-up emails to busy journalists hurt the long-term relationship.
- **If he covers doc-wiki:** don't promote the coverage on your own X / launch channels for at least 48 hours. Let it travel from his audience to yours organically.
- **Specific numbers worth dropping in the email body if traction warrants:** GitHub stars at the time of writing, current install velocity, named contributors. Only update the email if those numbers exist; don't fabricate.
