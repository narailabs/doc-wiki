# Anthropic Discord posts — paste-ready

> Two posts: one soft-seed in #showcase a week before launch (T-7 to T-3), one launch-day drop the morning of Show HN. Total Discord membership ~100k; the Anthropic team monitors regularly per Cat Wu's [Lenny's Newsletter interview](https://www.lennysnewsletter.com/p/how-anthropics-product-team-moves) ("we get feedback messages every five minutes").

## Channel selection

- **#showcase** (or equivalent — confirm channel name when you join; in-product Discord nav changes). Soft-seed and launch-day go here.
- **#claude-code** (general channel) — only post here on launch day, *not* during soft-seed week. And only if the conversation is naturally about plugins.
- **DM Boris / Alex / Cat:** DON'T cold-DM. They explicitly prefer being tagged in public posts they can choose to engage with.

## Post 1 — soft-seed (T-7 to T-3)

```
Hey folks 👋 building a Claude Code plugin called doc-wiki — keeps a
structured wiki over an entire codebase + Jira / Confluence / GitHub /
Notion / AWS / GCP / DB schemas, so the agent can work accurately on
messy enterprise code. On my own codebase autonomous ticket-fix rate
went from ~10% → ~80% after wiring it up.

Soft-launching publicly next week (Show HN + the usual circuit), but
wanted to get the Discord's eyes on it first since you'll spot any
obvious issues fastest.

Repo (Apache 2.0): github.com/narailabs/doc-wiki
Manifesto: github.com/narailabs/doc-wiki/blob/main/docs/manifesto.md
Reproducible benchmark in progress: github.com/narailabs/doc-wiki/tree/main/benchmark

Looking for: anyone willing to run /doc-wiki:atlas --dry-run on a
codebase you have open and tell me what the cost estimate / topic
discovery / facet plan looks like before I commit to it on real
projects.
```

## Post 2 — launch day (T-0)

```
Show HN went up this morning, Apache 2.0 plugin:
news.ycombinator.com/item?id=<YOUR_HN_ID>

It feeds Claude Code an ecosystem-aware wiki (code + Jira + Confluence
+ DB schemas) — autonomous ticket-fix rate on my codebase went from
~10% → ~80%. Reproducible benchmark in the repo against Django,
Cal.com, Mastodon.

Repo: github.com/narailabs/doc-wiki

The hardest 24h since I'll be live in the HN thread — if anyone here
has tried it during the soft-seed week and has things they want to
mention publicly there, that would be useful 🙏.
```

Don't ask for upvotes. Asking for upvotes is against HN's terms and Anthropic Discord users would correctly flag it. The phrasing above asks for *substantive comments* from people who've actually tried it — which is fine.

## Tagging strategy

**Don't tag** @Boris, @Alex, @Cat, etc. in the channel post directly.

**Do tag** them only if a thread breaks out where one of them naturally fits ("@cat curious if this would be a fit for the plugin spotlight you mentioned"). Public, public-tagged, content-justified.

## Engagement plan

- Be in the Discord between 9am ET and 8pm ET on launch day.
- Reply to every reaction or message within 15 minutes.
- For genuine technical questions: link to the right doc, then offer a 1:1 voice channel if the question is deep.
- For "could it do X" suggestions: open a GitHub issue together in real-time.

## Anti-patterns

- ❌ Don't paste the same content in multiple channels.
- ❌ Don't DM the Anthropic team directly (they prefer public posts).
- ❌ Don't ask Anthropic team members to RT / amplify.
- ❌ Don't post a screenshot of the HN ranking.
- ❌ Don't link to the post 3x as it climbs ("now #4!"). Once is enough.
