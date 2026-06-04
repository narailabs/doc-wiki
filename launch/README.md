# launch/ — executable campaign artifacts

> The plan is at [`../.claude/plans/how-can-i-get-iridescent-peach.md`](../.claude/plans/how-can-i-get-iridescent-peach.md) (paths relative to repo root). This directory holds the *pre-written content* you actually publish. Open each file when its slot fires; don't improvise.

Status fields below: ⬜ not yet · 🟦 ready (you can run it) · 🟨 do this now · 🟩 done.

## Pre-launch (T-21 → T-1)

| When | What | Where | File | Status |
|---|---|---|---|---|
| T-21..T-15 | Build benchmark harness against 1st repo | local | n/a (see `benchmark/PLAN.md`) | 🟦 |
| T-21..T-15 | Draft (already drafted, just publish) the manifesto | personal blog / `docs/manifesto.md` | [`../docs/manifesto.md`](../docs/manifesto.md) | 🟩 |
| T-21..T-15 | Build HN karma — 5–10 thoughtful comments | news.ycombinator.com | n/a | ⬜ |
| T-21..T-15 | Submit to community marketplace | clau.de/plugin-directory-submission | [`marketplace-submission.md`](marketplace-submission.md) | 🟦 |
| T-14..T-8 | Complete benchmark across all 3 repos | local | n/a | ⬜ |
| T-14..T-8 | Cold-email Simon Willison | email | [`cold-email-simonw.md`](cold-email-simonw.md) | 🟦 |
| T-14..T-8 | Submit to awesome lists | GitHub | [`awesome-list-submissions.md`](awesome-list-submissions.md) | 🟦 |
| T-7..T-1 | Soft post Anthropic Discord #showcase | Discord | [`discord-anthropic.md`](discord-anthropic.md) | 🟦 |
| T-7..T-1 | Post r/ClaudeCode workflow-share | Reddit | [`reddit-claudecode.md`](reddit-claudecode.md) | 🟦 |
| T-7..T-1 | Tweet at @bcherny / @alexalbert__ / @ClaudeDevs | X | [`x-soft-mention.md`](x-soft-mention.md) | 🟦 |

## Day 0 — Tuesday 8:30am PT

| Step | What | File | Notes |
|---|---|---|---|
| 1 | Post Show HN | [`show-hn.md`](show-hn.md) | The title + body + OP first comment + 3 rebuttal templates. Post first-comment within 5 minutes. |
| 2 | Pin X tweet with 60-sec video | [`x-thread.md`](x-thread.md) | The pinned tweet + reply thread. |
| 3 | Drop in Anthropic Discord #showcase | [`discord-anthropic.md`](discord-anthropic.md) | Different post from T-7 soft post. |
| 4 | Live for 24h | n/a | Reply within 30 min for first 12h, 2h cadence for next 12h. |

## Week 1 (T+1 to T+7)

| Day | What | File |
|---|---|---|
| T+1 | r/ClaudeAI post (different angle from r/ClaudeCode) | [`reddit-claudeai.md`](reddit-claudeai.md) |
| T+2 | r/ChatGPTCoding cross-post | [`reddit-chatgptcoding.md`](reddit-chatgptcoding.md) |
| T+2 | DM swyx (Latent Space) | [`cold-dm-swyx.md`](cold-dm-swyx.md) |
| T+3 | Cold email Gergely Orosz (Pragmatic Engineer) | [`cold-email-pragmatic-engineer.md`](cold-email-pragmatic-engineer.md) |
| T+3 | DM IndyDevDan / AI Jason | [`cold-dm-youtubers.md`](cold-dm-youtubers.md) |
| T+4 | Submit to Ben's Bites / TLDR AI tip forms | [`newsletter-tips.md`](newsletter-tips.md) |
| T+5 | Publish deep-dive on dev.to | [`devto-deepdive.md`](devto-deepdive.md) |

## Month 1 → Month 3

The plan covers cadence. The two artifacts in this directory for that window:
- [`cold-email-alex-albert.md`](cold-email-alex-albert.md) — Anthropic DevRel pitch (fires once community marketplace listing is live)
- [`case-study-template.md`](case-study-template.md) — for the first external case study

## What's deliberately missing here

- Conference CFPs (AI Engineer Code Summit, Code with Claude 2027) — the submission forms live on those sites; what doesn't are talk abstracts. Skipped V1; add when CFPs open.
- LinkedIn posts — dropped per research; not in the working channel set.
- Medium / Substack — dropped; dev.to gets the one canonical deep-dive.

## How to use a file

Each file has the same shape: one block of paste-ready text, followed by a `## Notes` section with posting time, tags, and "if X happens, do Y" branches. Do not edit the paste-ready text day-of unless you have a reason; you wrote it cold and rested. If something feels wrong, post anyway and iterate.

## Anti-pattern checklist (read before any launch action)

- [ ] Am I cheerleading Anthropic? (Don't.)
- [ ] Am I claiming an unbenched number? (Don't. The 10→80 number gets the "on my own enterprise codebase" qualifier every time; OSS numbers cite `benchmark/`.)
- [ ] Am I seeding booster comments from friends? (Don't. HN detects this.)
- [ ] Have I rested ≥6 hours since drafting this? (Required for cold-email files.)
- [ ] Is the response window I'm about to commit to realistic? (HN: 24h live. Cold emails: reply within 48h to any response.)
