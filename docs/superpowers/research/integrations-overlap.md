# Integrations Overlap: `integrations.md` vs Cross-Service External Dependencies

> Research date: 2026-06-07. Read-only analysis. Informs Phase D synthesis design.

---

## 1. What `integrations.md` IS today

**Source:** `agents/lib/atlas_synthesize.ts` `assembleIntegrationsInputs` (lines 252–308) + SKILL.md Phase 7 description.

`integrations.md` is a **wiki-level, page-mention-based, LLM-synthesized** page.

Its input bundle has exactly three parts:

1. **`api.md` wiki pages** — every per-topic page with `atlas_facet: api`. These are the per-topic API pages already compiled by `/doc-wiki:ingest` passes.
2. **External-service-ish lines from `architecture.md` pages** — a heuristic keyword scan over existing wiki pages. Keywords come from `builtinConnectorIds()` (jira, confluence, github, notion, aws, gcp — `db` filtered out) plus a curated SaaS list (`stripe`, `datadog`, `sentry`, `auth0`, `okta`, `twilio`, `sendgrid`). Any line in an `architecture.md` page body that contains one of these keywords is extracted and included in the bundle.
3. **`.connectors/config.yaml`** — the raw connector config file inlined verbatim.

The LLM synthesis step then produces the page. SKILL.md Phase 7 describes it as: "LLM-synthesize the external-services map." The page template in the compilation reference puts its shape as "Per-service subsection: credentials + actions + sample CLI" (audience: `integrator`).

**What integrations.md is NOT:**
- It is NOT per-service in the code-file sense. It scans compiled wiki pages (`.md` files), not source files.
- It is NOT static-code-derived. It does not parse datasource URLs, SDK imports, or HTTP client calls.
- It is NOT graph-edge-based. There are no typed `ServiceEdge` records.
- It does NOT track whether a connector is configured vs unconfigured at per-dependency granularity.

**Core characterization:** `integrations.md` = "which external *systems* the wiki's documentation mentions, plus the connector config." Its signal is: "does this repo's *docs* talk about Stripe/AWS/Jira?"

---

## 2. What the NEW External Dependencies view would be (D10)

Per the cross-service detection design (external-source detection + connector cross-reference):

The new view is **per-service, static-code-derived, graph-edge-based, with connector cross-reference.**

Its derivation path:
1. **Static detection (B7):** scan each service's source files for:
   - DB datasource URLs in `application*.{yml,properties}` (`spring.datasource.url`, `jdbc:...`, `postgres://`, `mongodb://`, etc.) → `kind: database`
   - Cloud SDK imports (`software.amazon.awssdk`/`aws-sdk`/`boto3` → `aws`; `com.google.cloud`/`@google-cloud` → `gcp`) → `kind: aws` or `kind: gcp`
   - Existing `code_clients` (`gather()`/`fetchWithCaps()` callsites) → `kind: narai_gather`
   - HTTP clients whose `target_ref` does NOT resolve to an internal service (Phase C classification) → `kind: http_external`
2. **Inventory bucket:** `external_sources: ExternalSourceEntry[]` per service, with `{ kind, detail, connector_id, configured, file, line }`.
3. **Phase C edges:** `external_source` edges (service → `ext:db`/`ext:aws`/... nodes) added to `service-graph.json`.
4. **Phase D render:** an "External Dependencies & Configured Connectors" section showing each service's external dependencies with a ✓ when the connector is configured.

**What the new view IS:**
- Per-service (one row/section per service, per dependency instance)
- Code-derived (from source file patterns, not wiki page text)
- Graph-edge-based (typed `ServiceEdge` records in `service-graph.json`)
- Connector cross-reference with explicit configured/unconfigured status per dependency

---

## 3. The boundary and recommendation

### Recommendation: **Option A — Distinct page, cross-link only**

The new external-dependencies view must be a **separate page** (or a section within `wiki/service-dependencies.md` or a new `wiki/external-dependencies.md`), not a modification of `integrations.md` or its assembly function.

**Reasoning:**

**Different derivation:** `integrations.md` scans compiled wiki pages for keyword mentions. The new view scans source files for imports and datasource URLs. These inputs are structurally incompatible — you cannot feed `ExternalSourceEntry[]` records into `assembleIntegrationsInputs` without distorting both the existing page's purpose and the new page's precision.

**Different granularity:** `integrations.md` is whole-wiki ("the system uses AWS"). The new view is per-service-per-dependency ("payments-module connects to `jdbc:postgresql://db/invoices`, connector `db` is configured"). Merging these into one page produces a page that serves neither audience well.

**Different audiences within the same `integrator` label:** `integrations.md` serves the integrator who wants to know "what external services does this system use, and how do I configure doc-wiki's connectors to ingest them?" The new page serves the integrator/operator who wants to know "which service owns each external dependency, and which are already covered by configured connectors vs require new connector setup?" These are different questions.

**Keep `assembleIntegrationsInputs` unchanged.** Option B (feeding static edges into `assembleIntegrationsInputs`) would couple a deterministic graph artifact to an LLM-synthesis bundle in a way that makes neither testable cleanly — the cross-service plan explicitly values deterministic rendering (D6) precisely to enable snapshot testing.

### Exact Phase D placement

The new external-dependencies content belongs in `cross_service_pages.ts` as a dedicated renderer. Two options, in preference order:

**Preferred:** A new section `## External Dependencies & Configured Connectors` appended to `wiki/service-dependencies.md` (rendered by `renderServiceDependencies` or a separate `renderExternalDependencies` called from the same Phase D5 CLI write step). This keeps all service-graph-derived pages in one module and avoids proliferating page counts. Task D2 already handles `renderServiceDependencies`; this section extends it or is a sibling renderer called in D5.

**Alternative:** A standalone `wiki/external-dependencies.md` page if the section grows large (many services × many external systems). In that case, the D5 CLI should add it to the write list alongside the existing six pages.

Either way: the page carries `atlas_facet: architecture` (not `integrations`) + `audience: integrator` + `sources:` pointing to the source files and config files from which the detections came.

### Non-overlap rule

| Dimension | `integrations.md` | New external-deps section/page |
|---|---|---|
| Input source | Compiled wiki `.md` pages (keyword scan) + `.connectors/config.yaml` | Source files (imports, datasource URLs) + `service-graph.json` |
| Derivation | LLM synthesis over keyword-matched lines | Deterministic render from `ExternalSourceEntry[]` |
| Granularity | Whole-wiki keyword mentions | Per-service, per-dependency-instance, per line |
| Connector status | Connector config inlined as raw YAML | Explicit `configured: true/false` per dependency |
| Module | `atlas_synthesize.ts assembleIntegrationsInputs` | `cross_service_pages.ts renderExternalDependencies` |
| Update trigger | Atlas Phase 7 (global synthesis, always) | Atlas Phase D5 (deterministic write, when `cross_service.enabled`) |

**Wording to explicitly avoid in the new page:** do not use the phrases "external-services map," "integration," or "connector setup" as section headings — those belong to `integrations.md`. Use "external dependencies," "datasource connections," and "configured connectors" instead. The new page should link to `integrations.md` with a one-line note: "For the full connector configuration reference and per-agent setup guide, see `wiki/integrations.md`."

**Wording to explicitly avoid in `integrations.md`:** do not add "per-service breakdown" sections, datasource URLs, or SDK import tables — those are the new page's territory.

---

## Summary of files examined

- `agents/lib/atlas_synthesize.ts` — `assembleIntegrationsInputs` implementation
- `skills/doc-wiki/SKILL.md` — Phase 7 global pages description + page template table
