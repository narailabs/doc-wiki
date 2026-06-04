# r/ClaudeCode soft-seed post — paste-ready

> Post T-7 to T-3, *before* the public launch. r/ClaudeCode has ~4.2k weekly active contributors (3× r/Codex per GummySearch). This is your warm-up audience — workflow-focused, technical, opinionated. The Show HN and r/ClaudeAI posts come *after* this one.

## Title

```
Anyone else dealing with Claude Code falling off on messy enterprise codebases? Here's the wiki layer I built.
```

113 chars. r/ClaudeCode's audience appreciates the genuine-question framing over launch-y framings.

## Body

```
Quick context: my day job is on a 500k LOC, 8-year-old codebase glued
to a Jira backlog stretching back to 2018. Claude Code is a daily
driver for the team. On clean greenfield work it's great; on tickets
that involve the actual messy parts, it gets things wrong in confident,
plausible-looking ways maybe 80–90% of the time. The most expensive
errors are when it doesn't *know* that the obvious fix was tried in
2023 and reverted because of (some Jira ticket).

So I built a Claude Code plugin to maintain a structured wiki over the
codebase + the ecosystem (Jira, Confluence, GitHub, Notion, DB
schemas), and inject the wiki into Claude's context via `CLAUDE.md`.

After wiring it up, autonomous ticket-fix rate on the same kinds of
tickets jumped to ~80% in my measurements. (Anecdotal — my codebase is
private. A reproducible benchmark is in progress against Django,
Cal.com, and Mastodon — I'll post numbers when they land.)

I'm soft-launching publicly next week but wanted to get reactions from
the r/ClaudeCode crowd first, because you're the closest thing to the
target audience.

Code: github.com/narailabs/doc-wiki (Apache 2.0)
Quick demo: /doc-wiki:init then /doc-wiki:atlas --dry-run on any
codebase you have open in Claude Code.

Questions I'm specifically asking for feedback on:
- Does the slash-command surface (10 commands) feel right or bloated?
- ORM/DB cross-validation is in 7 profiles (Prisma/SQLAlchemy/Django/
  JPA/TypeORM/ActiveRecord/Entity Framework). What's missing?
- Anyone running it on a Rails / Phoenix / Go codebase? Curious how
  well the architecture detection works outside the profiles I tested.
- General "is this the right shape" feedback before the wider launch.

Happy to walk through the architecture or send a Loom demo if useful.
```

## Notes

- **Tone:** genuinely asking for feedback. Not launch-y. The r/ClaudeCode crowd reads through marketing fast and downvotes it.
- **Timing:** the week before the Show HN. This gives 5–7 days for replies to surface real issues you'd want to fix before the wider launch.
- **Reply to everything.** Especially the "have you considered X" suggestions. These become the testimonial / contributor pool for week 1.
- **Respond to critique honestly.** If someone says "isn't this just RAG" — agree there's overlap, explain the compounding-artifact distinction, link to the manifesto. Don't get defensive.
- **No cross-posting.** This post is exclusive to r/ClaudeCode pre-launch. The r/ClaudeAI post on Day +1 should use entirely different wording.
- **Don't promise features in the comments.** "Will you add support for Y?" → "Open an issue on GitHub, I'd want to scope it before promising."
