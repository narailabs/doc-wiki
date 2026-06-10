# Show HN launch — paste-ready

## Title (≤70 chars, copy verbatim)

```
Show HN: doc-wiki – wiki layer that took my Claude Code accuracy from 10% to 80%
```

71 chars. If HN cuts it, the trailing accuracy number is what gets dropped; that's intentional — the hook is in the first 50 chars.

## URL field

```
https://github.com/narailabs/doc-wiki
```

## "Description" field (optional, leave blank)

HN's Show HN description field is rarely read. Leave it blank; the title carries the hook, the first OP comment carries the substance.

---

## OP first comment — post within 5 minutes of submission

```
Author here. Three things up front.

(1) Why I built it: my day-job codebase is 500k LOC, 8 years old, glued
to Jira/Confluence/four databases. Out-of-box Claude Code fixes ~10% of
real tickets autonomously; the other 90% it confidently produces a
plausible-looking diff that breaks something subtle (often something
that was already tried and reverted in 2023). After wiring up doc-wiki
— a maintained wiki over code + Jira + Confluence + DB schemas, indexed
into the agent's context — autonomous fix rate on the same kind of
tickets jumped to ~80%.

(2) The 80% number is anecdotal on my own codebase (it's private; I
can't show you). But I'm shipping a reproducible benchmark in the repo
against Django, Cal.com, and Mastodon — real closed issues, real fix
PRs as the success criterion, SWE-bench-style binary pass/fail. The
methodology is at benchmark/PLAN.md; re-run it yourself. The OSS
baseline-vs-doc-wiki delta is smaller than the personal-codebase delta
because OSS codebases are already cleaner than median enterprise code,
but it's still significant.

(3) What's not working yet: the benchmark numbers are still being
generated as I write this; check benchmark/results/ for the live table.
The harness handles Python / Node / Ruby toolchains assuming you have
them on PATH; no Docker yet. ORM cross-validation through wiki_db only
covers 7 profiles (Prisma, SQLAlchemy, Django, JPA, TypeORM,
ActiveRecord, Entity Framework); custom ORMs you'd have to add a
profile for.

Apache 2.0 forever — explicit no-relicense commitment in docs/
governance.md. Runs entirely inside your Claude Code session. No
SaaS, no daemon, no telemetry, no sign-up. The whole thing is the
Karpathy LLM Wiki pattern (https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)
pointed at complex enterprise code instead of personal notes — and it
works just as well on a small repo or on a root-of-microservices
submodule layout where the wiki documents how the services relate.

Manifesto: https://github.com/narailabs/doc-wiki/blob/main/docs/manifesto.md
Benchmark: https://github.com/narailabs/doc-wiki/tree/main/benchmark

Happy to argue methodology, defend the number, or hear that I'm wrong
about something. I'll be here for the next 24h.
```

Paste this verbatim. Do not add em dashes between the "(1)" "(2)" "(3)" blocks; HN reads them as bullets and Markdown-breaks the formatting.

---

## Rebuttal templates

Pre-written for the three highest-probability hostile threads. Reuse phrasing if the exact comment differs but the substance is the same.

### Rebuttal A — "Another Claude Code wrapper / RAG with extra steps"

```
Fair instinct, and worth unpacking. doc-wiki is not RAG over raw sources
— RAG re-fetches and re-chunks every query. doc-wiki produces a
maintained, compounding artifact (the wiki) once and then queries the
wiki, not the raw sources. The compounding-artifact distinction is
exactly what Karpathy named in the LLM Wiki gist; doc-wiki is the
enterprise execution of that pattern.

It's also not "another wrapper" — it doesn't proxy Claude calls or
mediate the model. It generates structured markdown the model reads
through your existing CLAUDE.md, then gets out of the way.

The thing that makes it interesting on real codebases is the ecosystem
ingest — Jira/Confluence/DB schemas/etc. through one planner. That's
the part nobody else is shipping as a Claude Code plugin. The closest
neighbors (DeepWiki, Augment Code's Context Engine) crawl code only and
ship as hosted SaaS.
```

### Rebuttal B — "The 80% number is sus / where's the benchmark"

```
The 80% number is anecdotal on a private codebase — I said so up front,
explicitly. The reproducible part is in benchmark/. Three repos
(Django, Cal.com, Mastodon), real closed issues from the last 18
months, the specific test the fix PR added as the success criterion.
Binary pass/fail. No LLM-judge. The harness is in TypeScript; the
issue manifest is YAML; per-run JSON is committed.

What's not in the repo yet (because the runs are in progress as you
read this): the actual results table. I'll be posting it under
benchmark/results/ as it lands. If you want to re-run with a different
set of issues, swap them in repos.yaml. The Apache-2.0 license
includes the right to argue with the methodology, and that's the
contract.

Honest caveats: agent benchmarks have known variance (60% → 25%
re-run degradation in published literature). I'll be running each cell
≥3× and reporting median + spread.
```

### Rebuttal C — "What about the Anthropic Pro plan / model quality flap"

```
That's a different problem (Anthropic-side, model + product). doc-wiki
patches a layer above the model — context engineering. The model
quality fluctuations affected every Claude Code workflow over the last
quarter; what doc-wiki does is independent of model version, because
the wiki is the agent's working memory and not the agent itself.

Specifically: on the same Anthropic API surface, with the same Sonnet
4.6 model, the question is what you put in the context window. Raw
codebase chunks vs. a maintained wiki distilling the same code +
ecosystem are very different inputs. The benchmark holds the model
fixed and varies that input.

That said — yes, model quality matters too, and Anthropic's
postmortem (https://www.infoq.com/news/2026/05/anthropic-claude-code-postmortem/)
was a real read of a real problem. doc-wiki doesn't fix that; it
fixes a different bottleneck.
```

---

## Notes

- **Post time:** Tuesday 8:30am Pacific. Daniel King's 2026 Show HN analysis: Tuesday 8–10am PT has the best success-rate-per-post-volume ratio.
- **Karma minimum:** 10+ HN karma before submitting. New zero-karma accounts get auto-killed by the filter.
- **Comment cadence:** every comment within 30 min for the first 12h, every 2h for the next 12h. Stop responding around the 24h mark; the thread is over by 48h regardless.
- **Don't seed booster comments from friends.** HN moderators detect this; you will be flamed. The first comment is yours (the OP backstory above). Everything after is organic.
- **The pinned X tweet should fire at the same minute as the HN post.** See `x-thread.md`.
- **Track:** screenshot the position on `/show` every hour for the first 6 hours; useful for the post-mortem regardless of outcome.
- **If it flames out (no upvotes after 90 min):** don't bump, don't repost, don't email YC. Take the L; the channel works as a check.
- **If it hits front page:** the GitHub repo readme should already be polished (it is) and `benchmark/` should be live (it is). Add a single follow-up comment with the "we're at #N on the front page, thank you" at the 6h mark — no more.
