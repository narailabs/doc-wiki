# Case-study template

> Use this when the first external user (contributor or friendly enterprise) is willing to share their numbers. Goal: a 500–800 word writeup that's defensible and publishable on the user's blog or in `docs/case-studies/`. T+30 to T+60 window.

## When to ask for a case study

After a user has:
- Used doc-wiki for ≥2 weeks
- Run `/doc-wiki:atlas` on a real (not toy) codebase
- Has actual ticket-fix numbers from at least 10 real tickets
- Is willing to put their name (or org name) on the writeup

## The ask (DM/email template)

```
Hey [name] — I noticed you've been using doc-wiki on [codebase / context]
for a few weeks. I'm collecting case studies showing what the tool
actually does on real codebases (not benchmarks).

If you're up for it: 500-ish words on (a) what your codebase looks
like, (b) what you tried doc-wiki for, (c) what changed in concrete
numbers, (d) what didn't work or what's still rough. I'd publish it
under docs/case-studies/ in the doc-wiki repo and link from the
README. Happy to draft it from a 30-min interview if you don't want
to write it yourself.

What would you need from me to make this comfortable to publish?
```

## The template

```markdown
---
title: "Case study: [Org name or "anonymous contributor"] — [one-line headline]"
type: case-study
date: <ISO date>
codebase_size: "<approximate LOC>"
codebase_age: "<years old>"
stack: "[language] / [framework] / [ORM] / [DB]"
ticket_volume: "<tickets evaluated>"
---

# Case study: [Org name or anonymous] — [headline]

## The codebase

[1 paragraph. Be specific without leaking proprietary detail. "An internal
Django service serving 200M monthly requests, 8 years old, ~600k LOC,
Postgres-backed, glued to Atlassian (Jira + Confluence) and AWS." If
the org is named, use the org name; otherwise keep anonymous.]

## What we tried doc-wiki for

[1 paragraph. The specific problem they expected doc-wiki to address.
"Claude Code worked great on greenfield endpoints but failed at any
ticket touching the legacy billing module." Avoid abstract framing —
the specifics make this credible.]

## What changed (in numbers)

| Metric | Before doc-wiki | After doc-wiki |
|---|---|---|
| Autonomous ticket-fix rate | <%> | <%> |
| Sample size | <N tickets> | <N tickets> |
| Mean tokens per fixed ticket | <K tokens> | <K tokens> |
| Mean cost per fixed ticket | $<X.XX> | $<X.XX> |
| Mean time-to-fix (when fixed) | <minutes> | <minutes> |

Methodology notes from the contributor:
[1–2 sentences. "Sampled 30 closed tickets from Q1 2026; ran each through
Claude Code with and without doc-wiki; counted as 'fix' if all existing
tests passed and at least one engineer code-reviewed the diff as
correct."]

## What worked

[2–3 bullet points. Specific moments. "doc-wiki's ORM cross-validation
caught two cases where the agent was about to write to a column that
no longer existed in the schema." "The Jira ingest let Claude reference
a 2023 ticket explaining why we don't use Redis for session storage."]

## What didn't work / what's rough

[2–3 bullet points. Critical voice required — this is what makes the
case study credible. "doc-wiki's REST endpoint detection missed our
custom Express middleware pattern; we had to write a profile."
"/doc-wiki:atlas took 45 minutes on our 600k-LOC repo and cost $34;
the cost estimate was within 10% so no surprise but expect it to take
real wall time."]

## What we changed in our workflow

[1 paragraph. "After 3 weeks, we made /doc-wiki:refresh part of the
nightly cron, integrated /doc-wiki:lint --fix into the pre-merge
check, and added the wiki references to our CLAUDE.md template for
new services."]

## Recommend?

[1 paragraph. The verdict + caveats. "Yes for codebases over ~50k LOC
with multi-service ecosystem complexity. Probably overkill for clean
greenfield work. Caveat: the OSS benchmark numbers are real but your
mileage will vary; we'd encourage every team to run the benchmark on
their own codebase before adopting widely."]

---

*This case study was contributed by [name + role + org] and is published
under the same Apache 2.0 license as doc-wiki. The data was collected
between [date] and [date] using doc-wiki version [X.Y.Z] against
Claude Code [version].*
```

## Notes

- **Numbers must be real.** If the contributor doesn't have rigorous numbers, the case study isn't ready. Use the harness in `benchmark/` against their codebase if they're willing.
- **Anonymization is fine.** Many enterprise users can share patterns but not org names. "Internal Fortune-500 SaaS, ~500k LOC, Django" is plenty.
- **Always include "what didn't work."** A 100%-glowing case study damages credibility; reviewers discount it. Make criticism a required field.
- **Edit lightly, not heavily.** The contributor's voice carries authenticity. Resist the urge to smooth their prose.
- **First case study unlocks the rest.** Once one publishes, the next 2-3 follow naturally because the format is normalized.
- **Don't pay or compensate.** OSS case studies are most credible when uncompensated. Free contributor swag is the only acceptable thank-you.
- **After publication:** link from the README's `## Reproducible benchmark` section. Quote one sentence in the next Pragmatic Engineer / Alex Albert pitch.
