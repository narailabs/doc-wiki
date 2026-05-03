# Roadmap

doc-wiki's deferred work tracker. Each entry is one well-scoped PR or task.
Items are grouped by milestone (**Before main release** vs **v2**); within
each sub-section, items are roughly priority-ordered (top = most leverage).

**Milestones:**

- **Before main release** — must land before doc-wiki is "tested and
  ready to start making content about it." Bar: stable enough to
  dogfood publicly, demos won't embarrass us, end-to-end runs on real
  repos without surprises.
- **v2 (post-main-release)** — additive features, optimizations,
  speculative items. Not blocking.

**Status legend:**

- `proposed` — open, no PR
- `accepted` — likely picked up next session
- `in-flight` — PR open
- `shipped` — merged (kept here briefly for cross-reference, then pruned)

This file is hand-maintained. Move items to "Recently shipped" with their
PR number when merged. Speculative items live separately; they need a
design round before prioritization.

---

## Before main release

### Atlas — pipeline validation

- **Real `/doc-wiki:atlas` dogfood** — full pipeline (Phase 6 included),
  not partial globals. Costs ~$3-10 of LLM time. Only way to validate
  the audience-aware + manifest-driven changes hold up end-to-end. _proposed_
- **`ecosystem.rest.enabled` orchestrator wiring** — atlas skill reads
  the flag and passes `--enable-rest` accordingly. Closes a loose end
  from PR #14 (currently the orchestrator-prompt has to know to read
  this flag). _proposed_

### Atlas — REST profile correctness

Bug fixes on already-shipped profiles. Each affects real-world code
in ways that would show up in any honest demo.

- **Flask default-GET case** — `@app.route('/x')` without `methods=`
  defaults to GET. Needs a profile-shape extension to support a
  hardcoded fallback method when no method group captures. ~10 LOC. _proposed_
- **ASP.NET controller-level `[Route("...")]` prefix concatenation** —
  currently each `[HttpGet("/x")]` is taken as the full path; should
  prepend the class-level `[Route(...)]` prefix. _proposed_
- **Hono `.use()` middleware vs `.get()` route disambiguation** —
  current regex catches both; should distinguish (middleware ≠ route). _proposed_

### Atlas — manifest consumers (quality)

The Phase 1b code-inventory manifest landed in PR #12. These two
consumers improve *output quality* — Phase 6 surfaces ORM entities the
current heuristics miss; lint catches broken code-locality refs early.
(The two perf-only consumers — Phase 4, query scoping — are deferred
to v2.)

- **Phase 6 source-heuristic replacement** — `data-model` facet sources
  from `manifest.orm_entities`; `api` from `manifest.rest_endpoints`.
  Replaces glob heuristics with deterministic lookups; surfaces ORM
  entities the current heuristics miss. _proposed_
- **`/doc-wiki:lint` references-frontmatter validation** — flag pages
  whose `references:` points to source files the inventory has never
  seen. Catches broken code-locality refs early. _proposed_

### Documentation

- **`docs/atlas.md`** — full Phase 1-8 walkthrough including the
  Phase 1b inventory step. The atlas command is the tentpole; deserves
  its own doc beyond the existing `docs/architecture.md` Diagram 4. _proposed_
- **`docs/configuration.md` `ecosystem.rest` section** — deferred from
  PR #14. Describe the block (enabled flag, custom_profiles slot,
  example custom YAML). _proposed_
- **Custom REST profile authoring guide** — example YAMLs + how to
  test. Probably belongs as a new file under `docs/` or a section in
  `docs/architecture.md`. _proposed_

---

## v2 (post-main-release)

### Atlas — manifest consumers (perf)

Performance / precision wins on top of the Phase 1b manifest. No
behavior change visible in output; defer until after main release.

- **Phase 4 cost-estimate consumes manifest** — skip cache lookups for
  files already in the manifest. Performance win, no behavior change.
  _proposed_
- **`/doc-wiki:query` manifest scoping** — when the question is about
  an API surface, scope link-following to known endpoints. Reduces
  synthesis cost; improves precision. _proposed_

### Atlas — REST profile router/DSL expansions

Common in real Django/Rails apps but each needs a route-tree / DSL
expansion walker. Substantial work; ship main release with the
straight-line profiles, expand router patterns post-launch.

- **Django DRF ViewSet routers** — `router.register(r'users', UserViewSet)`
  expands to multiple endpoints via the DRF router. Needs a route-tree
  walker. _proposed_
- **Rails `resources :foo` blocks** — DSL expansion (`resources :users`
  → 7 RESTful routes). _proposed_

### Atlas — heuristic discovery / "learning loop"

Original framing from PR #14: doc-wiki should learn with the code, not
just match shipped profiles. With 18 profiles shipped (10 from PRs
#14+#15, 8 from PR #17), the major frameworks are covered; the
learning loop is a substantial new feature, not a main-release blocker.

- **Heuristic regex fallback** — catch HTTP-route-shaped patterns
  (`(?:get|post|put|delete)\s*\(\s*['"\`][/]`) even when no profile
  marker matches; emit as `framework: "unknown"` /
  `confidence: low`. Highest-leverage item in this section. _proposed_
- **Gap-report wiring for unknown hits** — surface as "potential
  undocumented endpoint — write a profile or dismiss" actionables;
  autonomy-mode-aware. Closes the learning loop. _proposed_
- **Language-aware default profile prioritization** —
  `project_metadata.language` drives which profiles run first; reduces
  false positives from cross-language patterns (e.g., a Java-shaped
  string in a Python file shouldn't fire Spring). _proposed_
- **Profile-suggestion tool** — given heuristic hits, generate a draft
  `RestProfile` YAML the user can refine. Closes the loop on
  customization. _proposed_

### Atlas — other detection bucket types

Beyond REST endpoints + code clients, more structural code can be
inventoried. All purely additive — nothing blocks main release.

- **GraphQL schema introspection** — `*.graphql`, code-first SDL
  (`gql`-tagged template literals) → type+field inventory. _proposed_
- **gRPC service definitions** — parse `*.proto` → service + method
  inventory. _proposed_
- **Message-queue producer/consumer detection** — Kafka / RabbitMQ /
  SQS / Pub-Sub publish + subscribe call sites. _proposed_
- **WebSocket endpoints** — `socket.on(...)`, Phoenix Channels, etc. _proposed_
- **CLI command inventory** — argparse / click / yargs / clap / cobra
  command trees. _proposed_

### Speculative (lower confidence)

These have come up but aren't recommended without more design.

- **Atlas plugin model** — third-party profiles published as npm
  packages. `ecosystem.rest.custom_profiles` already covers most needs;
  this is overkill.
- **Cross-repo manifest comparison** — diff inventories between two refs
  to see what changed. Useful for PR review automation; large lift.
- **Manifest as input to `/doc-wiki:promote`** — auto-generate api pages
  from `rest_endpoints`. Quality of auto-generated pages is suspect; big
  lift.
- **`assembleX` walker further consolidation** —
  `assembleCommandsInputs` + `assembleGettingStartedInputs` have
  walker-adjacent logic (heading extraction, JSON parsing) that doesn't
  fit `walkRepoTargets`. PR #13 left them alone deliberately.
- **Per-page quality scoring integrates manifest** — e.g., a data-model
  page should reference its ORM entities. Couples scoring to manifest,
  narrows scoring's general applicability.
- **`/doc-wiki:onboard` uses inventory to skip Q&A** — pre-fill some
  Q&A answers from the inventory. Modest UX win, requires careful
  fallback for non-inferable answers.
- **`/doc-wiki:stats` shows inventory metrics** — endpoints/clients/
  entities count per run. Easy to ship; low value vs other items.

---

## Recently shipped (atlas hardening series)

| PR | Title | Date |
|---|---|---|
| #11 | feat(atlas): audience-aware globals + gap report + Mermaid seeds | 2026-04-30 |
| #12 | feat(atlas): pre-Phase-2 code-inventory manifest (Tranche C) | 2026-04-30 |
| #13 | refactor(atlas): consolidate deploy + configuration walkers | 2026-05-01 |
| #14 | feat(atlas): REST profile expansion + custom profiles | 2026-05-02 |
| #15 | feat(atlas): six new REST profiles (Django / Flask / ASP.NET / Gin / Laravel / Hono) | 2026-05-02 |
| #17 | feat(atlas): eight more REST profiles (Fastify / Koa / Echo / Rocket / Actix / Slim / Phoenix / Vapor) | 2026-05-02 |

These six PRs took atlas from a five-facet code-shaped pipeline to an
audience-aware, manifest-driven, eighteen-REST-profile pipeline with
custom profile loading. The roadmap above tracks what was deliberately
deferred during that series.
