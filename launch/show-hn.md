# Show HN launch — paste-ready

## Title (≤70 chars, copy verbatim)

Recommended (artifact hook; the null goes in the OP comment where it has context):

```
Show HN: doc-wiki – turn your codebase into a wiki coding agents read
```

69 chars.

Alternate (transparency hook — riskier: a bare "null" in the title invites drive-by dismissal before anyone reads why it's interesting):

```
Show HN: doc-wiki – wiki for coding agents; benchmark null published
```

68 chars.

## URL field

```
https://github.com/narailabs/doc-wiki
```

## "Description" field (optional, leave blank)

HN's Show HN description field is rarely read. Leave it blank; the title carries the hook, the first OP comment carries the substance.

---

## OP first comment — post within 5 minutes of submission

```
Author here. Three things up front, including the one that usually
gets buried.

(1) What it is: one command (/doc-wiki:atlas) inside your coding agent
turns a codebase into a maintained wiki — per-topic architecture pages,
ER diagrams derived from your actual ORM models, and a cross-service
map generated automatically when it detects more than one service
(point it at a root repo with your services as submodules and it
documents how they relate, not just what each one does). Jira,
Confluence, GitHub, GitLab, Notion, Linear, AWS, GCP, and your DB
schemas route in through one connector planner. The agent reads the
wiki through CLAUDE.md / AGENTS.md — works across Claude Code, Codex,
Cursor, Gemini, Aider, and friends. It scales down too: a small
single-repo project gets the same wiki, leaner.

(2) The honest part: I built a hardened SWE-bench-style benchmark to
test whether the wiki lifts the agent's *fully autonomous* ticket-fix
rate — container-isolated, Anthropic-only egress firewall, sanitized
ticket bodies, contamination floors, pre-registered calibration. Four
configurations, 92 valid ticket pairs on two OSS repos: baseline
passed 57/92, wiki passed 54/92. No measured lift. I'm publishing
that null in full at benchmark/RESULTS.md instead of shipping a
favorable slice — the per-run artifacts and the harness are in the
repo; re-run it on your own codebase and argue with the data. The
analysis of *why* (ceiling effects, floor effects, and one
seductive-looking +3 that's backport-duplicate variance) is in the
same file.

(3) So why use it? Because the benchmark measures one narrow regime:
an agent alone in a box with a single OSS repo and a well-written
ticket. That regime is bimodal — the model either already solves the
ticket without help, or no single-shot session solves it with any
context. Where I actually work is neither: ecosystem-heavy enterprise
code, tickets whose context lives in Jira threads and DB schemas, and
me in the loop — reading the cross-service map to scope a change,
pointing the agent at the right pages, catching the wrong turn at
diff two instead of after deploy. On my own private 500k-LOC codebase
my fix rate went from ~10% to ~50% used that way — one engineer's
anecdote, labeled as such, in a regime the benchmark doesn't reach.
The artifact has to justify itself on inspection: generate the wiki
on your repo and look at it.

Apache 2.0 forever — explicit no-relicense commitment in the manifesto
(docs/manifesto.md). Runs entirely inside your agent session. No SaaS,
no daemon, no telemetry, no sign-up. It's the Karpathy LLM Wiki
pattern (https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)
pointed at enterprise code instead of personal notes.

Benchmark: https://github.com/narailabs/doc-wiki/blob/main/benchmark/RESULTS.md
Manifesto: https://github.com/narailabs/doc-wiki/blob/main/docs/manifesto.md

Happy to argue methodology or hear that I'm wrong about something.
I'll be here for the next 24h.
```

Paste this verbatim. Do not add em dashes between the "(1)" "(2)" "(3)" blocks; HN reads them as bullets and Markdown-breaks the formatting.

---

## Rebuttal templates

Pre-written for the highest-probability hostile threads. Reuse phrasing if the exact comment differs but the substance is the same.

### Rebuttal A — "Your own benchmark says it doesn't work. Why would anyone use it?"

```
The benchmark says one specific thing: on single-repo OSS tickets, an
agent working fully autonomously doesn't pass more test suites with
the wiki than without. That's worth knowing and it's why I published
it — most tools in this space ship the favorable slice.

What it doesn't measure: the regime where a human uses the wiki *with*
the agent (scoping from the cross-service map, pointing at the right
pages, catching wrong turns early), enterprise codebases whose context
lives outside the repo (Jira/Confluence/DB schemas), or any
multi-service layout. Those are unbenchmarked — by me or anyone. I'm
explicit in RESULTS.md about which claims died (autonomous lift) and
which remain open.

The pitch is the artifact, not a pass-rate delta: ER diagrams from
your real ORM models, a cross-service map, cited answers over
code + tickets + docs. Generate it on your repo and judge it by
inspection. If a maintained, agent-readable map of your system isn't
useful to you, don't install it.
```

### Rebuttal B — "Another Claude Code wrapper / RAG with extra steps"

```
Fair instinct, and worth unpacking. doc-wiki is not RAG over raw
sources — RAG re-fetches and re-chunks every query. doc-wiki produces
a maintained, compounding artifact (the wiki) once and then queries
the wiki, not the raw sources. The compounding-artifact distinction is
exactly what Karpathy named in the LLM Wiki gist; doc-wiki is the
enterprise execution of that pattern.

It's also not "another wrapper" — it doesn't proxy Claude calls or
mediate the model. It generates structured markdown the model reads
through your existing CLAUDE.md, then gets out of the way.

The part nobody else ships as a plugin is the ecosystem ingest —
Jira/Confluence/GitLab/Linear/DB schemas through one planner, plus the
cross-service map over a submodule layout. The closest neighbors
(DeepWiki, Augment's Context Engine) crawl code only and ship as
hosted SaaS.
```

### Rebuttal C — "The 10%→50% number is sus"

```
It's an anecdote and labeled as one everywhere it appears — my own
private 500k-LOC codebase, me in the loop, so I can't show it to you
and I don't headline it. When I tried to turn it into a benchmark I
could publish, the autonomous single-repo version came out null, and
that's the number in the repo. The honest position, which is the one
I'm taking: the human-in-the-loop enterprise regime where the ~50%
lives is unbenchmarked, and until that changes the artifact has to
justify itself on inspection.
```

### Rebuttal D — "What about the Anthropic Pro plan / model quality flap"

```
Different problem (Anthropic-side, model + product). doc-wiki operates
a layer above the model — what goes in the context window. The wiki is
the agent's working memory, not the agent itself, and it's
model-version-independent; the benchmark holds the model fixed and
varies only the context input. Model quality matters too — Anthropic's
postmortem was a real read of a real problem — but it's a different
bottleneck than the one doc-wiki addresses.
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
- **If it hits front page:** the GitHub repo readme should already be polished (it is) and `benchmark/RESULTS.md` should be live (it is). Add a single follow-up comment with the "we're at #N on the front page, thank you" at the 6h mark — no more.
- **Never claim an autonomous-accuracy lift anywhere in the thread.** The published benchmark is null; every accuracy mention is either the null (cited) or the ~10%→~50% anecdote (qualified: private codebase, human in the loop, unbenchmarked regime).
