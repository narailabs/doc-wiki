# The LLM Wiki for enterprise code

> A manifesto for what coding agents need to work on real codebases — complex enterprise systems and simple side projects alike — and why doc-wiki is what it is.

## The 10× gap nobody is fixing

Claude Code is genuinely incredible on small, clean, well-documented codebases. Hand it a Flask plugin, a hexagonal-architecture FastAPI service, a fresh Rails monolith with model-level docs — it'll fix tickets autonomously, write tests, refactor cleanly, all under $0.50 per ticket. The Anthropic engineering blog and the [Pragmatic Engineer's 2026 AI tooling survey](https://newsletter.pragmaticengineer.com/p/ai-tooling-2026) tell us this is the median experience for most users.

That isn't the experience most people have at work.

The codebase I look at five days a week is 8 years old, 500k LOC, three frameworks deep, glued to Jira issues that explain *why* things are the way they are, Confluence pages that explain *which* assumptions we already broke trying to fix it the obvious way, a database schema that drifted from the ORM models three refactors ago, and another 40 services in the ecosystem that nobody fully understands. When I let Claude Code rip on a real ticket in that codebase, it fixes the ticket end-to-end on its own — without me touching anything between issue title and merged PR — maybe 10% of the time. The other 90%, it confidently writes a plausible-looking diff that breaks production, regresses a related feature, or solves the wrong half of the problem because nobody told it that the obvious fix was tried in 2023 and reverted with a 200-line postmortem.

The model isn't the bottleneck. **Context is the bottleneck.** Claude can't see what isn't in its window, and dumping the whole repo is impossible — and useless even when it fits, because raw source code is exactly the wrong shape of input for "should I refactor this controller or write a new service."

## What Karpathy named

On April 4, 2026, Andrej Karpathy [posted a gist](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) describing what he called the LLM Wiki pattern: a maintained, compounding artifact of distilled knowledge that the LLM reads instead of re-deriving the same answers from raw sources every time you talk to it. He pointed it at his personal notes — a synthesis of papers he reads, blog posts he writes, ideas he wants to revisit. Within two weeks there were 50+ open-source implementations (Synto, OmegaWiki, claude-obsidian, Synthadoc, Mnemosyne, …). The pattern was contagious because it solved an obvious problem.

That gist is the conceptual root of doc-wiki. doc-wiki is what the LLM Wiki looks like when you point it at a 500k-LOC enterprise monolith instead of personal notes.

Two extensions matter.

**First: the wiki has to cover the ecosystem, not just the code.** A codebase doesn't live in isolation. The Jira tickets that drove the last 6 months of work are part of the codebase. The Confluence page that records *why* the cache was sharded by user-id and not session-id is part of the codebase. The Postgres schema, with the columns the ORM models forgot to update, is part of the codebase. The Notion runbook for the deploy pipeline is part of the codebase. doc-wiki ingests all of it through one planner — `gather()` from [narai-primitives](https://github.com/narailabs/narai-primitives) — into one wiki the agent can read.

**Second: the wiki has to be maintained.** Static "documentation" rots within months. doc-wiki ships with `/doc-wiki:refresh`, `/doc-wiki:lint`, content-hash drift detection, and an autonomy-mode system that lets you delegate the boring upkeep. The wiki isn't a one-time crawl; it's a living artifact that survives refactors.

The output: a structured wiki under `docs/<app>-wiki/`. Frontmatter on every page. Typed edges (`supports`, `contradicts`, `extends`, `supersedes`) in `graph/edges.jsonl`. A `summaries.md` index loaded first by `/doc-wiki:query`. References injected into your `CLAUDE.md`. Claude Code reads it before touching code. No SaaS, no daemon, no telemetry — everything runs inside your existing Claude Code session in your terminal.

## What complex enterprise code looks like and what the wiki carries

Here's the test I use for whether a codebase needs doc-wiki: ask three new engineers to fix the same ticket independently, with no human in the loop. If they produce three different, equally-defensible diffs and at least one breaks in subtle ways, your codebase needs doc-wiki. If they all produce the same diff in five minutes, it doesn't — though doc-wiki still works fine on those simpler codebases; it just has less to do.

For complex enterprise codebase cases — and the cross-service case where the root repo holds microservices in submodules and the wiki documents how the services relate to each other — doc-wiki pages tend to cover:

- **Architecture facets** — module boundaries that are tribal knowledge, not enforced by the build system. Why service X owns endpoint Y. The unwritten rules about which patterns are "the new way" vs "the legacy way."
- **Data model** — which ORM model maps to which physical table. Where the schema drifted. Which fields are nullable in theory but never in practice. ORM cross-validation with the live DB through `wiki_db`'s read-only policy gate.
- **Environment + secrets** — what env var names exist, what they're for, where they resolve from (env / keychain / file / cloud secret), the lazy-resolution rules so credentials never traverse the LLM context.
- **External services** — every connector dispatched through `gather()` is a page describing the integration: rate limits, retry policy, what kinds of mocks exist for local dev, which endpoints are read-only safe.
- **Operations** — runbook pages for the deploy pipeline, observability stack, alerting rules. The kind of thing that's currently a 47-page Confluence document nobody reads end-to-end.
- **History** — promoted query answers, postmortems, decisions made and reversed. The `supersedes` edge type matters here. Past attempts at obvious-looking fixes are linked to the page describing why they failed. Claude reads them, doesn't repeat them.

A wiki shaped like this isn't "documentation" in the sense your engineering org failed to maintain in 2019. It's working memory for the agent, structured the way the agent reads. It scales down too: a 200-line side project gets a leaner wiki with the same structure, and the same `/doc-wiki:atlas` workflow applies.

## How accurate, actually

Here is the part most launch posts don't include: **I benchmarked my own tool and it did not beat the baseline.**

I built a hardened SWE-bench-style harness — container-isolated sessions behind an Anthropic-only egress firewall, sanitized and detainted ticket bodies, training-data contamination floors, pre-registered test calibration — and ran four configurations across two OSS repos (vitest, saleor), two models (Sonnet, Opus), and one ticket set hand-picked for the regime a wiki should dominate: ORM models, migrations, FK relationships. Ninety-two valid ticket pairs. **The wiki arm did not improve the autonomous ticket-fix pass rate in any of them** (baseline 57/92, wiki 54/92). The full data, the per-regime mechanics — a ceiling effect on one repo, a floor effect on the schema set, a duplicate-ticket artifact behind the one cell that looked positive — are published in [`benchmark/RESULTS.md`](../benchmark/RESULTS.md). Re-run it yourself; swap the ticket list; argue with the numbers. That's the contract.

So why does the tool exist? Because the benchmark measures one narrow thing: an agent alone in a box with a single OSS repo and a well-written ticket. That regime turns out to be bimodal — either the model already solves the ticket without help, or the ticket is a feature-sized change no single-shot session solves with any context. Neither mode is where I work, and probably not where you work either. My days are ecosystem-heavy enterprise code, tickets whose real context lives in Jira threads and DB schemas, and me *in the loop* — reading the wiki's cross-service map to scope the change, pointing the agent at the right pages, catching the wrong turn at diff two instead of after the deploy. My ~10%→~50% experience lives in that regime. It's an anecdote on a codebase I can't open-source, I label it as such everywhere, and I no longer treat it as the headline: the honest position is that the human-plus-agent, enterprise, cross-service regime is **unbenchmarked** — by me or anyone — and the artifact has to justify itself on inspection until that changes.

The reproducibility literature says agent benchmarks are noisy even when done carefully — [Paul Simmering](https://simmering.dev/blog/agent-benchmarks/) shows 60% → 25% degradation across re-runs and 51% → 26% lab-to-production gaps. Our published runs are single-run-per-arm; the caveats (variance, ticket-family duplicates, ceiling/floor regimes) are in [`benchmark/METHODOLOGY.md`](../benchmark/METHODOLOGY.md), not a footnote. If you run the harness and see something different — in either direction — I want to hear about it.

## Why Apache 2.0 forever

This is the part of the manifesto that some readers will want to skip and that enterprise readers will want first.

doc-wiki is Apache 2.0 today and is committed to staying that way. No relicensing, no rug pull, no "open core" with the good parts behind a paywall. There won't be a hosted SaaS that quietly takes over the OSS roadmap. There won't be a Series B that makes a different decision necessary.

The pattern that creates standards in dev tooling — Terraform, dbt, Pydantic, Backstage — is the same: stay OSS until the tool is the standard, then build a *separate* commercial layer that doesn't degrade the OSS. The pattern that destroys standards — Terraform → OpenTofu, Redis → Valkey, Elastic → OpenSearch — is the same too: change the license once you have leverage, and the community forks the previous version within a quarter. Every enterprise legal team has now learned the difference, and they check for explicit relicense-risk language before approving a tool.

So here is the explicit language. doc-wiki is Apache 2.0. doc-wiki will remain Apache 2.0. The license file will not change in a future commit. The repository will not be relicensed under any circumstances, by me or by any maintainer who comes after me. If a maintainer ever attempts to relicense, they are violating this commitment, and you should fork the last Apache-2.0 commit and continue. The current commit is the canonical version forever.

That commitment is what makes "doc-wiki as a standard" a coherent ambition rather than a bait-and-switch.

## What I want you to do

Three things, in order of effort.

**One.** Install it. `claude plugin install narailabs/doc-wiki`. Run `/doc-wiki:onboard` on a codebase you actually work in. Try `/doc-wiki:atlas --dry-run` to see what it'd cost to document the whole thing in one pass. Ask a real question with `/doc-wiki:query`. If it's useful, tell me what worked. If it isn't, tell me what didn't.

**Two.** Re-run the benchmark on a repo of your choice. Swap the three repos in `repos.yaml` for whatever codebase you want to argue about. If the numbers come out differently than mine, publish them. The Apache-2.0 license includes the right to disagree with my methodology.

**Three.** If this matches a pattern you've been wanting from your tools, name it. "LLM Wiki for enterprise code" is a working phrase. "Context engineering for enterprise codebases" is another. dbt invented "analytics engineering" and a job category emerged from it. If the LLM Wiki pattern grows into something a job title gets named after, it'll be because the people doing the work named it.

The plugin is ready. The benchmark is ready to reproduce. The license is set in stone. The pattern is contagious. Now we find out whether it's the standard.

---

— rfv (`@narailabs`), May 2026.

Apache 2.0. Forever.
