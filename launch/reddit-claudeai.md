# r/ClaudeAI post — paste-ready

> Post T+1 (the day after Show HN). 862K subscribers. The angle should *differ from r/ClaudeCode* (which you post the week before) and *differ from the Show HN* (workflow-share framing, not launch-marketing framing).

## Title

```
I built a Claude Code plugin that lifted my autonomous ticket-fix accuracy from ~10% to ~80% on a real enterprise codebase. Open-sourcing the wiki layer.
```

149 chars. Reddit allows 300; long title is fine here, the audience reads it.

## Subreddit choice

r/ClaudeAI (the larger / general one). For r/ClaudeCode (smaller / more workflow-focused), see `reddit-claudecode.md` — different post, posted T-7 to T-3 as a soft seed.

## Body

```
TL;DR — Claude Code is great on clean small codebases. On the
8-year-old enterprise codebases most of us actually work in, it fixes
maybe 10% of tickets autonomously and quietly breaks things on the
other 90%. I built a plugin that lifts that to ~80% on my own codebase
by feeding the agent a maintained wiki over code + Jira + Confluence +
GitHub + DB schemas. Open-sourced today: github.com/narailabs/doc-wiki.

Apache 2.0 forever, runs in your existing Claude Code session, no SaaS.

---

**The actual problem**

Real-world codebases aren't shaped like the SWE-bench fixtures.
8 years of accumulated patterns. A DB schema that drifted from the ORM
models three refactors ago. Half the answers buried in Jira tickets
from 2022. Another 40 services in the ecosystem nobody fully
understands.

Claude can't see what isn't in its context window. Dumping the whole
repo doesn't fit, and wouldn't be useful even if it did, because raw
source is the wrong shape of input for "should I refactor or write a
new service here?"

**What I built**

doc-wiki is a Claude Code plugin (Apache 2.0). 10 slash commands:

- /doc-wiki:init — scaffold
- /doc-wiki:onboard — detect language, ORM, DB, external services
- /doc-wiki:atlas — document the whole codebase in one phased pass
- /doc-wiki:ingest — add a source (file / URL / Jira ticket / Confluence)
- /doc-wiki:query — synthesize a cited answer from the wiki
- /doc-wiki:promote — turn a good query answer into a permanent page
- /doc-wiki:refresh — keep sources current
- /doc-wiki:lint, :fix, :stats

Output is a structured markdown wiki at `docs/<app>-wiki/`. Claude Code
reads it via your `CLAUDE.md` before touching code.

External services route through one planner (`gather()` from
narai-primitives) — Jira, Confluence, GitHub, Notion, AWS, GCP, plus
read-only DB connectors with a policy gate. You configure credentials
once.

ORM cross-validation against the live DB through 7 profiles: Prisma,
SQLAlchemy, Django, JPA, TypeORM, ActiveRecord, Entity Framework.

**The number**

On my own (private) codebase: ~10% → ~80% autonomous ticket-fix
accuracy after wiring it up. Anecdotal — explicitly. The number you
care about is the reproducible one in benchmark/ — Django, Cal.com,
Mastodon, real closed issues, SWE-bench-style binary pass/fail. Re-run
it yourself if you want to argue with it.

**What I want from you**

Try it on a codebase that's actually messy and tell me what works /
doesn't. Pop a /doc-wiki:atlas --dry-run, see what it estimates. The
plugin is at github.com/narailabs/doc-wiki. Manifesto + benchmark linked
from the README.

Built it solo, no funding. Happy to argue methodology, defend numbers,
hear that I'm wrong.
```

---

## Notes

- **Post time:** weekday morning (Mon-Thu 8–11am ET works best on r/ClaudeAI based on top-of-subreddit cadence).
- **Flair:** "Showcase" or "Tools" if those flairs exist; otherwise leave blank.
- **First-hour engagement:** check in every 30 min for the first 4h. Reply to every comment within 20 min. Reddit's first-hour velocity is what determines whether a post gets on the front page of the sub.
- **Don't cross-post.** Posting the same content to r/ClaudeCode the same day will get flagged. The r/ClaudeCode post (separate file, different angle) goes the week before.
- **If a mod removes it for self-promotion:** message the mods politely, point out that the post is workflow-share with explicit open-source commitment, no commercial element. Most mod teams will reinstate.
- **DM strategy:** if someone DMs asking how to use it on their codebase, respond. These DMs are the people who become contributors.

## Cross-channel coordination

Same day:
- ⛔ Don't tweet this post. Reddit and X don't share audiences and double-posting reads thirsty.
- ⛔ Don't drop the link in the Anthropic Discord (you already did the Discord post on Day 0).

Day after (T+2):
- ✅ Cross-post a different angle to r/ChatGPTCoding (see `reddit-chatgptcoding.md`).
- ✅ DM swyx (see `cold-dm-swyx.md`).
