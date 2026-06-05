# Anthropic plugin marketplace submission

> Two tiers. Submit to community first; aim for official + Verified later as traction signal warrants.

## Community marketplace (do this first, T-14)

Submission URL: [`clau.de/plugin-directory-submission`](https://clau.de/plugin-directory-submission) (the canonical short link; redirects to the current submission form on `code.claude.com`).

Lead-time: ~2 weeks review per the [Sunpeak guide](https://sunpeak.ai/blogs/claude-connector-directory-submission/) (verified May 2026). Submit by T-14 so listing lands before Show HN.

### Pre-flight checklist

- [ ] `claude-plugin.json` (or equivalent manifest) at repo root is current and includes:
  - `name`, `description`, `version`, `homepage`, `repository`
  - `tags` (use: `documentation`, `wiki`, `knowledge-base`, `enterprise`, `agents`, `narai-primitives`)
  - `icon` (square, ≥256×256, hosted in the repo at `media/icon.png`)
- [ ] README hero block live (already done)
- [ ] Apache-2.0 LICENSE file at repo root (already done)
- [ ] All `/doc-wiki:*` slash commands have descriptions matching their actual behavior (security review checks this)
- [ ] No telemetry / no phone-home / no analytics in any of the scripts — grep the repo before submitting
- [ ] `docs/governance.md` published (already done) — reviewers will look for it

### Submission form fields

When the form asks for the elevator pitch, paste:

```
doc-wiki maintains a living wiki of your codebase + Jira + Confluence
+ GitHub + Notion + AWS/GCP + ORM/DB schemas — fed to Claude Code as
context. Lifts autonomous ticket-fix accuracy from ~10% to ~80% on the
author's enterprise codebase; reproducible benchmark on 3 OSS repos in
the repo. Apache 2.0 forever.
```

When asked for the "what category does this fit":
```
Documentation / Context Engineering
```

When asked for the security posture:
```
Runs entirely in the user's Claude Code session. Read-only connectors
through narai-primitives, all credentials resolved inside connector
subprocesses (never traverse the LLM context). DB connector has a
4-mode policy gate (ALLOW / DENY / ESCALATE / PRESENT_ONLY). No
network calls outside connector subprocess dispatch. No telemetry.
```

### After submission

- Send a one-line follow-up to the Anthropic community-marketplace contact ~7 days in if no acknowledgement, polite.
- Once accepted: update `launch/README.md` status field to 🟩 done.
- Once accepted: the listing URL goes in the `cold-email-alex-albert.md` body (placeholder `<COMMUNITY_MARKETPLACE_URL>` — replace it).

## Official marketplace + Verified (T+30 onward, conditional)

Application happens via the same form but with the "Verified" track requested. Verified-tier conditions per current public guidance:

- Community-tier listing live and stable ≥30 days
- Repository has CI passing on every PR
- Releases signed via GitHub Attestations (sigstore-backed)
- Security disclosure policy in `docs/governance.md` (done)
- Tool descriptions match actual behavior (automated + human review)
- ≥1k GitHub stars OR documented enterprise adopter (≥1 named user)

Apply when 4-of-6 are met, not before. The `cold-email-alex-albert.md` artifact fires in parallel to support the application.
