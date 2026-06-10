# Awesome-list submissions

> Five lists, in priority order. Fire all five between T-14 and T-7.

## 1. hesreallyhim/awesome-claude-code

**Repo:** [github.com/hesreallyhim/awesome-claude-code](https://github.com/hesreallyhim/awesome-claude-code) (45K stars, the canonical list).

**Process:** Automated. Do NOT open a PR — only Claude (the bot) is allowed to merge PRs there. Use the submission script per their CONTRIBUTING.md.

**Submission step:** Run their script from your local clone of doc-wiki and follow prompts. Quality bar: "high quality skills, agents, hooks... suitable for beginners and veterans with an emphasis on code quality, security, and originality." doc-wiki easily meets the bar.

**Submission text (when prompted for description):**
```
Maintained wiki over code + Jira + Confluence + GitHub + Notion +
AWS/GCP + ORM/DB schemas, indexed into Claude Code's context. Apache
2.0 forever. Lifts autonomous ticket-fix accuracy ~10%→~80% on enterprise
codebases; reproducible benchmark in repo. 10 slash commands cover
init/onboard/atlas/ingest/query/lint/fix/promote/refresh/stats.
```

**Turnaround:** <2 weeks typical.

## 2. ccplugins/awesome-claude-code-plugins

**Repo:** [github.com/ccplugins/awesome-claude-code-plugins](https://github.com/ccplugins/awesome-claude-code-plugins)

**Process:** Standard PR. Open a PR adding doc-wiki under the appropriate section (likely `Documentation` or `Knowledge Management`).

**PR title:**
```
Add doc-wiki: ecosystem-aware wiki for complex enterprise codebases
```

**PR body:**
```
Adds doc-wiki under Documentation.

- Repo: github.com/narailabs/doc-wiki (Apache 2.0)
- 10 /doc-wiki:* slash commands
- Ingests code + Jira + Confluence + GitHub + Notion + AWS/GCP + ORM/DB schemas
- Reproducible benchmark in benchmark/

Happy to revise to match the list's current shape.
```

**Turnaround:** Variable, watch the PR queue.

## 3. ComposioHQ/awesome-claude-plugins

**Repo:** [github.com/ComposioHQ/awesome-claude-plugins](https://github.com/ComposioHQ/awesome-claude-plugins)

**Process:** PR, same shape as above. Composio's list is curated by their team; PR review is usually <1 week.

Same PR title + body as ccplugins/awesome-claude-code-plugins works.

## 4. rohitg00/awesome-claude-code-toolkit

**Repo:** [github.com/rohitg00/awesome-claude-code-toolkit](https://github.com/rohitg00/awesome-claude-code-toolkit) (aggregates 135 agents, 176+ plugins).

**Process:** PR.

Same template; add under the matching category.

## 5. Third-party aggregators

These are auto-indexed; you submit a URL and they crawl:

- [claudemarketplaces.com](https://claudemarketplaces.com/) — submit form
- [claudepluginhub.com](https://www.claudepluginhub.com/) — submit form
- [aitmpl.com/plugins](https://aitmpl.com/plugins) — submit form
- [awesome-skills.com](https://awesome-skills.com/) — submit form

Time cost: ~10 min each.

## After all submissions

Update `launch/README.md` status fields to 🟩 as each listing lands.

## Anti-patterns

- ❌ Don't open the same PR title across all 5 — minor variations are fine.
- ❌ Don't follow up on the awesome-claude-code automated submission. The script handles it.
- ❌ Don't submit while the README still has placeholders. Reviewers check for "is this real?"
- ✅ Do submit before Show HN, not after. Listings carry credibility signal *into* the launch.
