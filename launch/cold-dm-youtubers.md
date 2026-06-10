# Cold DM / email — YouTubers (IndyDevDan + AI Jason)

> T+3 to T+5. These two cover Claude Code weekly and have tightly fit audiences. Matthew Berman is a stretch (broader audience, less Claude Code specific) but worth a single DM.

## Channels & contact

| Creator | Channel | Subs | Contact |
|---|---|---|---|
| **IndyDevDan** | youtube.com/@indydevdan | ~150K | X DM @indydevdan; email if on Passionfroot |
| **AI Jason** | youtube.com/@AIJasonZ | ~280K | X DM @jasonzhou1993; email if on Passionfroot |
| **Matthew Berman** | youtube.com/@matthew_berman | ~500K+ | [passionfroot.me/matthew-berman](https://www.passionfroot.me/matthew-berman) |

## Template — short version (X DM)

```
Hey — built doc-wiki, Apache 2.0 Claude Code plugin that does
ecosystem-aware context (code + Jira + Confluence + DB schemas as one
wiki). Hit Show HN Tuesday (link), ~10%→~80% autonomous ticket-fix
on the author's enterprise codebase, reproducible benchmark in repo.

Built a 5-min Loom walkthrough for reviewers: <LOOM_URL>

If it might fit a Claude Code video, happy to send anything you need
(extra demos, deeper architecture walkthrough, code-on-screen
recording for a specific use case you want to show). Repo:
github.com/narailabs/doc-wiki
```

## Template — long version (email, when Passionfroot/contact form requires more)

```
Subject: doc-wiki — Apache 2.0 Claude Code plugin, possible video fit

Hi [name],

I open-sourced doc-wiki this week — an Apache 2.0 Claude Code plugin
that solves the "Claude Code falls off on complex enterprise codebases"
problem by maintaining a structured wiki over code + Jira + Confluence
+ GitHub + Notion + AWS/GCP + ORM/DB schemas (and the root-of-
microservices submodule case, where it documents how the services
relate to each other; works fine on smaller projects too). The agent
reads the wiki through `CLAUDE.md` before touching code.

On the author's enterprise codebase (private, 500k LOC, 8 years old),
autonomous ticket-fix accuracy went from ~10% to ~80% after wiring it
up. A reproducible benchmark — Django, Cal.com, Mastodon, SWE-bench-
style — ships in the repo at benchmark/.

Why I'm reaching out: your Claude Code coverage is the most useful
content in the space, and your audience is exactly the people who'd
benefit from this. Three things I can offer if it's a video fit:

(1) A 5-min Loom walkthrough designed for you to use as A-roll:
<LOOM_URL>

(2) A code-on-screen recording of any specific use case you want to
demo — pick the codebase (or I can run it on a popular OSS repo). Sent
within 24h of request.

(3) Time for a recorded interview / pair-coding session if you do
those, on your schedule.

No expectation of coverage. Even "no thanks" or "come back at X stars"
is helpful — calibrates where I should focus.

Repo: github.com/narailabs/doc-wiki
Manifesto: github.com/narailabs/doc-wiki/blob/main/docs/manifesto.md
Show HN: news.ycombinator.com/item?id=<HN_ID>

— rfv
```

## Notes

- **Customize per creator.** IndyDevDan's audience cares about practical "how to use Claude Code on a real codebase" — emphasize the production angle. AI Jason's audience cares about pattern + LLM theory — lead with the LLM Wiki framing. Matthew Berman's audience is broader AI consumer-curious — emphasize the benchmark number.
- **Send a 30-second self-intro Loom *in the DM*** if Loom is awkward to navigate to. Keep total request weight <2 minutes for them.
- **Hit-rate:** 25% read, 10% engage, 2-5% actually make a video. IndyDevDan has the highest hit-rate on tight-fit Claude Code content; AI Jason responds when the pattern angle is sharp; Matthew Berman almost never engages on cold DMs but you do it anyway because the reach is asymmetric.
- **Don't follow up on a single non-response.** Re-engage at 30 days only if you have new traction signal (Pragmatic Engineer mention, Anthropic blog feature, named-enterprise case study).
- **If they make a video:** thank publicly *once*, on launch day or video drop day. Don't share their video to your own channels for 48h. Let it travel organically.
