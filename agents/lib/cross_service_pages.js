/**
 * cross_service_pages.ts — deterministic renderer for the service-map wiki page.
 *
 * Pure renderers — no fs, no network. Operates only on the passed graph + inventory.
 * The D5 CLI (`writeCrossServicePages` + `main`) adds frontmatter and writes to disk.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { formatGraph, formatErDiagram } from "./mermaid_format.js";
import { rankInbound, detectCycles, loadServiceGraph } from "./cross_service_edges.js";
import { loadInventory } from "./atlas_inventory.js";
import { parseFlags } from "../../skills/doc-wiki/scripts/_cli_args.js";
import { parseFrontmatter } from "../../skills/doc-wiki/scripts/_frontmatter.js";
// Synthetic-node prefixes that must NOT appear as service topology nodes.
const SYNTHETIC_PREFIXES = ["ext:", "queue:", "table:", "auth:"];
function isSynthetic(id) {
    return SYNTHETIC_PREFIXES.some((p) => id.startsWith(p));
}
/**
 * Derive the common API path prefix for a list of endpoint paths.
 * Returns the longest leading prefix up to 2 segments that all paths share,
 * in the form `/api/seg`. Falls back to `—` when there are no endpoints or
 * no common prefix of the form `/api/{seg}`.
 */
export function _apiPrefix(paths) {
    if (paths.length === 0)
        return "—";
    // Extract the first two path segments (after the leading slash).
    function leading(p) {
        return p.split("/").filter((s) => s.length > 0).slice(0, 2);
    }
    const segsPerPath = paths.map(leading);
    const first = segsPerPath[0];
    if (first.length === 0)
        return "—";
    // Find how many leading segments all paths share with `first`.
    let common = first.length;
    for (let i = 1; i < segsPerPath.length; i++) {
        const s = segsPerPath[i];
        let match = 0;
        for (let j = 0; j < Math.min(common, s.length); j++) {
            if (first[j] === s[j])
                match++;
            else
                break;
        }
        common = Math.min(common, match);
    }
    if (common === 0)
        return "—";
    const prefix = "/" + first.slice(0, common).join("/");
    return prefix;
}
/**
 * Render the `service-map.md` body from a `ServiceGraph` and a `CodeInventory`.
 *
 * Sections produced:
 *   1. `## Service Topology` — Mermaid `graph LR` of real services + calls edges
 *      between them.
 *   2. `## Service Dependencies (from clients)` — `| Source | Targets |` table,
 *      one row per service that has outgoing `calls` edges to real services.
 *   3. `## API Path Prefixes` — `| Service | API Prefix |` table derived from
 *      the inventory's per-service REST endpoints.
 *
 * No frontmatter is emitted — that is the D5 CLI's responsibility.
 */
export function renderServiceMap(graph, inventory) {
    const serviceIds = new Set(graph.services.map((s) => s.id));
    // ── 1. Mermaid topology ───────────────────────────────────────────────
    const nodes = graph.services.map((s) => ({
        id: s.id,
        label: s.kind === "service"
            ? s.id
            : `${s.id}<br/>(${s.kind})`,
    }));
    // Only DIRECT calls edges (not transitive "via lib …") where both endpoints
    // are real (non-synthetic) services. Transitive edges are summarized below.
    const isTransitive = (detail) => detail.startsWith("via lib ");
    const topoEdges = graph.edges
        .filter((e) => e.kind === "calls" &&
        serviceIds.has(e.from_service) &&
        serviceIds.has(e.to_service) &&
        !isSynthetic(e.from_service) &&
        !isSynthetic(e.to_service) &&
        !isTransitive(e.detail))
        .map((e) => ({ from: e.from_service, to: e.to_service }));
    // Deduplicate edges (same from→to may appear multiple times).
    const seenEdges = new Set();
    const dedupedEdges = [];
    for (const e of topoEdges) {
        const key = `${e.from}|${e.to}`;
        if (!seenEdges.has(key)) {
            seenEdges.add(key);
            dedupedEdges.push(e);
        }
    }
    const block = formatGraph("LR", "Service Topology", nodes, dedupedEdges);
    const mermaidFence = ["```mermaid", block.code, "```"].join("\n");
    // Count distinct (from, to) transitive pairs for the summary note.
    const transitivePairs = new Set();
    for (const e of graph.edges) {
        if (e.kind === "calls" &&
            serviceIds.has(e.from_service) &&
            serviceIds.has(e.to_service) &&
            !isSynthetic(e.from_service) &&
            !isSynthetic(e.to_service) &&
            isTransitive(e.detail)) {
            transitivePairs.add(`${e.from_service}|${e.to_service}`);
        }
    }
    const transitiveNote = transitivePairs.size > 0
        ? `> + ${transitivePairs.size} transitive ${transitivePairs.size === 1 ? "dependency" : "dependencies"} inferred via shared libraries (see [client-registry.md](client-registry.md)).`
        : null;
    // ── 2. Dependency table ───────────────────────────────────────────────
    // Group calls edges by source into direct and transitive target sets.
    const directBySource = new Map();
    const transitiveBySource = new Map();
    for (const e of graph.edges) {
        if (e.kind !== "calls" ||
            isSynthetic(e.from_service) ||
            isSynthetic(e.to_service) ||
            !serviceIds.has(e.to_service))
            continue;
        if (isTransitive(e.detail)) {
            const set = transitiveBySource.get(e.from_service) ?? new Set();
            set.add(e.to_service);
            transitiveBySource.set(e.from_service, set);
        }
        else {
            const set = directBySource.get(e.from_service) ?? new Set();
            set.add(e.to_service);
            directBySource.set(e.from_service, set);
        }
    }
    // Union of all sources that have any calls edge.
    const allSources = new Set([...directBySource.keys(), ...transitiveBySource.keys()]);
    const depRows = [...allSources]
        .sort((a, b) => a.localeCompare(b))
        .map((src) => {
        const direct = [...(directBySource.get(src) ?? [])].sort((a, b) => a.localeCompare(b));
        const transitive = [...(transitiveBySource.get(src) ?? [])].sort((a, b) => a.localeCompare(b));
        const directCell = direct.length > 0 ? direct.join(", ") : "—";
        const transitiveCell = transitive.length > 0 ? transitive.join(", ") : "—";
        return `| ${src} | ${directCell} | ${transitiveCell} |`;
    });
    const depTable = [
        "| Source | Direct Targets | Via Shared Libs |",
        "|---|---|---|",
        ...depRows,
    ].join("\n");
    // ── 3. API prefix table ───────────────────────────────────────────────
    const prefixRows = (inventory.services ?? []).map((svc) => {
        const paths = (svc.rest_endpoints ?? []).map((e) => e.path);
        const prefix = _apiPrefix(paths);
        return `| ${svc.identity.id} | ${prefix} |`;
    });
    const prefixTable = [
        "| Service | API Prefix |",
        "|---|---|",
        ...prefixRows,
    ].join("\n");
    // ── Assemble ──────────────────────────────────────────────────────────
    const parts = [
        "## Service Topology",
        "",
        mermaidFence,
        "",
    ];
    if (transitiveNote !== null) {
        parts.push(transitiveNote, "");
    }
    parts.push("## Service Dependencies (from clients)", "", depTable, "", "## API Path Prefixes", "", prefixTable);
    return parts.join("\n");
}
/**
 * Render the `feign-clients.md` body (client registry) from a `ServiceGraph`
 * and a `CodeInventory`.
 *
 * Sections:
 *   1. `## Summary`    — `| Target Service | Inbound Clients | Primary Callers |`
 *   2. `## By Source`  — `| Source | Target | Methods |`
 *   3. `## Dependency Matrix` — ASCII grid, rows = sources, cols = targets
 *
 * No frontmatter emitted.
 */
export function renderClientRegistry(graph, inventory) {
    // Collect all real-service calls edges (no synthetic endpoints).
    const callsEdges = graph.edges.filter((e) => e.kind === "calls" &&
        !isSynthetic(e.from_service) &&
        !isSynthetic(e.to_service));
    // ── 1. Summary: group by target ───────────────────────────────────────
    const byTarget = new Map();
    for (const e of callsEdges) {
        const set = byTarget.get(e.to_service) ?? new Set();
        set.add(e.from_service);
        byTarget.set(e.to_service, set);
    }
    const summaryRows = [...byTarget.entries()]
        .sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]))
        .map(([target, callers]) => {
        const sorted = [...callers].sort((a, b) => a.localeCompare(b));
        return `| ${target} | ${callers.size} | ${sorted.join(", ")} |`;
    });
    const summaryTable = [
        "| Target Service | Inbound Clients | Primary Callers |",
        "|---|---|---|",
        ...(summaryRows.length > 0 ? summaryRows : ["| — | — | — |"]),
    ].join("\n");
    // ── 2. By Source: one row per (source, target) pair ──────────────────
    // Collect distinct methods/paths per (source, target) pair using edge detail.
    const bySourceTarget = new Map();
    for (const e of callsEdges) {
        const key = `${e.from_service}|${e.to_service}`;
        const set = bySourceTarget.get(key) ?? new Set();
        set.add(e.detail);
        bySourceTarget.set(key, set);
    }
    const sourceRows = [...bySourceTarget.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, methods]) => {
        const [src, tgt] = key.split("|");
        const sorted = [...methods].sort((a, b) => a.localeCompare(b));
        return `| ${src} | ${tgt} | ${sorted.join(", ")} |`;
    });
    const sourceTable = [
        "| Source | Target | Methods |",
        "|---|---|---|",
        ...(sourceRows.length > 0 ? sourceRows : ["| — | — | — |"]),
    ].join("\n");
    // ── 3. Dependency Matrix ──────────────────────────────────────────────
    const sources = [...new Set(callsEdges.map((e) => e.from_service))].sort((a, b) => a.localeCompare(b));
    const targets = [...new Set(callsEdges.map((e) => e.to_service))].sort((a, b) => a.localeCompare(b));
    let matrixSection;
    if (sources.length === 0 || targets.length === 0) {
        matrixSection = "No cross-service calls detected.";
    }
    else {
        const callSet = new Set(callsEdges.map((e) => `${e.from_service}|${e.to_service}`));
        const header = `| Source \\ Target | ${targets.join(" | ")} |`;
        const sep = `|---|${targets.map(() => "---").join("|")}|`;
        const rows = sources.map((src) => {
            const cells = targets.map((tgt) => (callSet.has(`${src}|${tgt}`) ? "x" : " "));
            return `| ${src} | ${cells.join(" | ")} |`;
        });
        matrixSection = [header, sep, ...rows].join("\n");
    }
    // ── Assemble ──────────────────────────────────────────────────────────
    return [
        "# Service Client Registry",
        "",
        "## Summary",
        "",
        summaryTable,
        "",
        "## By Source",
        "",
        sourceTable,
        "",
        "## Dependency Matrix",
        "",
        matrixSection,
    ].join("\n");
}
/**
 * Render the `rabbitmq-queues.md` body (queue registry) from a `ServiceGraph`
 * and a `CodeInventory`.
 *
 * Section: `## Queue Registry` — `| Queue | Publisher(s) | Consumer(s) | Message |`
 *
 * Publishers = real services with a `produces` edge to `queue:<name>`.
 * Consumers  = real services with a `consumes` edge from `queue:<name>`.
 * Message    = first non-empty `message_type` from inventory queue_endpoints for that queue.
 *
 * No frontmatter emitted.
 */
export function renderQueueRegistry(graph, inventory) {
    // Collect queue names from produces/consumes edges.
    const queueNames = new Set();
    for (const e of graph.edges) {
        if (e.kind === "produces") {
            // to_service is "queue:<name>"
            const name = e.to_service.startsWith("queue:")
                ? e.to_service.slice("queue:".length)
                : null;
            if (name)
                queueNames.add(name);
        }
        else if (e.kind === "consumes") {
            // from_service is "queue:<name>"
            const name = e.from_service.startsWith("queue:")
                ? e.from_service.slice("queue:".length)
                : null;
            if (name)
                queueNames.add(name);
        }
    }
    // For each queue, find publishers and consumers (real service ids).
    const rows = [...queueNames].sort((a, b) => a.localeCompare(b)).map((queue) => {
        const qNode = `queue:${queue}`;
        // Publishers: edges where kind=produces and to_service === qNode
        const publishers = graph.edges
            .filter((e) => e.kind === "produces" && e.to_service === qNode && !isSynthetic(e.from_service))
            .map((e) => e.from_service);
        const distinctPublishers = [...new Set(publishers)].sort((a, b) => a.localeCompare(b));
        // Consumers: edges where kind=consumes and from_service === qNode
        const consumers = graph.edges
            .filter((e) => e.kind === "consumes" && e.from_service === qNode && !isSynthetic(e.to_service))
            .map((e) => e.to_service);
        const distinctConsumers = [...new Set(consumers)].sort((a, b) => a.localeCompare(b));
        // Message type: first non-empty from inventory
        let messageType = "—";
        outer: for (const svc of inventory.services ?? []) {
            for (const qe of svc.queue_endpoints ?? []) {
                if (qe.queue_name === queue && qe.message_type) {
                    messageType = qe.message_type;
                    break outer;
                }
            }
        }
        const pub = distinctPublishers.length > 0 ? distinctPublishers.join(", ") : "—";
        const con = distinctConsumers.length > 0 ? distinctConsumers.join(", ") : "—";
        return `| ${queue} | ${pub} | ${con} | ${messageType} |`;
    });
    const registryTable = [
        "| Queue | Publisher(s) | Consumer(s) | Message |",
        "|---|---|---|---|",
        ...(rows.length > 0 ? rows : ["| — | — | — | — |"]),
    ].join("\n");
    return [
        "# Message Queue Registry",
        "",
        "## Queue Registry",
        "",
        registryTable,
    ].join("\n");
}
/** Humanize ORM relationship type names for the DB-trace table. */
function humanizeRelType(type) {
    switch (type) {
        case "one_to_many": return "hasMany";
        case "many_to_one": return "belongsTo";
        case "one_to_one": return "has";
        case "many_to_many": return "manyToMany";
        default: return type;
    }
}
/** Map ORM relationship type to a Mermaid ER cardinality token. */
function relTypeToCardinality(type) {
    switch (type) {
        case "one_to_many": return "||--o{";
        case "many_to_one": return "}o--||";
        case "one_to_one": return "||--||";
        case "many_to_many": return "}o--o{";
        default: return "||--o{";
    }
}
/**
 * Render the `database-trace-*.md` body from a `CodeInventory`.
 *
 * Per-service sections (only for services that have ORM entities):
 *   - `## <service-id>`
 *   - Table: `| Entity | Schema.Table | Repository | Key Relationships |`
 *   - Mermaid erDiagram of that service's entities + relationships
 *
 * No frontmatter emitted.
 */
export function renderDbTraces(inventory) {
    const sections = ["# Database Traces", ""];
    for (const svc of inventory.services ?? []) {
        const entities = svc.orm_entities ?? [];
        if (entities.length === 0)
            continue;
        sections.push(`## ${svc.identity.id}`, "");
        // ── Entity table ──────────────────────────────────────────────────
        const rows = entities.map((e) => {
            const schemaTable = e.schema_name
                ? `${e.schema_name}.${e.table_name}`
                : e.table_name;
            const rels = (e.relationships ?? [])
                .map((r) => `${humanizeRelType(r.type)} ${r.target_entity}`)
                .join(", ") || "—";
            return `| ${e.class_name} | ${schemaTable} | — | ${rels} |`;
        });
        const table = [
            "| Entity | Schema.Table | Repository | Key Relationships |",
            "|---|---|---|---|",
            ...rows,
        ].join("\n");
        sections.push(table, "");
        // ── Mermaid erDiagram ─────────────────────────────────────────────
        const erTables = entities.map((e) => ({
            name: e.class_name,
            columns: (e.columns ?? []).map((c) => ({ name: c.name })),
        }));
        const erRelationships = entities.flatMap((e) => (e.relationships ?? []).map((r) => ({
            from: e.class_name,
            to: r.target_entity,
            cardinality: relTypeToCardinality(r.type),
            label: humanizeRelType(r.type),
        })));
        const block = formatErDiagram(`${svc.identity.id} Entities`, erTables, erRelationships);
        const fence = ["```mermaid", block.code, "```"].join("\n");
        sections.push(fence, "");
    }
    return sections.join("\n").trimEnd();
}
/**
 * Render the `shared-libraries.md` body from a `ServiceGraph` and a
 * `CodeInventory`.
 *
 * Sections:
 *   1. `## Which Libraries Does Each Service Need?` — `| Service | Required Libraries |`
 *      Rows for every non-library service, sorted by id.
 *   2. `## Library Consumers` — reverse lookup `| Library | Used By |` from
 *      `depends_on` edges.
 *
 * No frontmatter emitted.
 */
export function renderSharedLibraryMatrix(graph, inventory) {
    // Index library_deps per service from inventory for fast lookup.
    const depsById = new Map();
    for (const svc of inventory.services ?? []) {
        depsById.set(svc.identity.id, svc.library_deps ?? []);
    }
    // Real (non-library) services from the graph, sorted by id.
    const realServices = graph.services
        .filter((s) => s.kind === "service" || s.kind === "frontend")
        .sort((a, b) => a.id.localeCompare(b.id));
    // ── 1. Service → Required Libraries ──────────────────────────────────
    const serviceRows = realServices.map((s) => {
        const libs = depsById.get(s.id) ?? [];
        const cell = libs.length > 0 ? libs.join(", ") : "—";
        return `| ${s.id} | ${cell} |`;
    });
    const serviceTable = [
        "| Service | Required Libraries |",
        "|---|---|",
        ...(serviceRows.length > 0 ? serviceRows : ["| — | — |"]),
    ].join("\n");
    // ── 2. Library → Consumers (reverse, from depends_on edges) ──────────
    const libConsumers = new Map();
    for (const e of graph.edges) {
        if (e.kind !== "depends_on")
            continue;
        const libId = e.to_service;
        const set = libConsumers.get(libId) ?? new Set();
        set.add(e.from_service);
        libConsumers.set(libId, set);
    }
    const libRows = [...libConsumers.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([lib, consumers]) => {
        const sorted = [...consumers].sort((a, b) => a.localeCompare(b));
        return `| ${lib} | ${sorted.join(", ")} |`;
    });
    const libTable = [
        "| Library | Used By |",
        "|---|---|",
        ...(libRows.length > 0 ? libRows : ["| — | — |"]),
    ].join("\n");
    // ── Assemble ──────────────────────────────────────────────────────────
    return [
        "# Shared Libraries",
        "",
        "## Which Libraries Does Each Service Need?",
        "",
        serviceTable,
        "",
        "## Library Consumers",
        "",
        libTable,
    ].join("\n");
}
// Synthetic-node prefixes (duplicated locally to keep renderServiceDependencies pure).
const SYNTHETIC_PREFIXES_DEP = ["ext:", "queue:", "table:", "auth:"];
function isSyntheticDep(id) {
    return SYNTHETIC_PREFIXES_DEP.some((p) => id.startsWith(p));
}
/**
 * Render the `service-dependencies.md` body from a `ServiceGraph` and a
 * `CodeInventory`.
 *
 * Sections produced:
 *   1. `## Most Depended Services`    — ranked by inbound `calls` count
 *   2. `## Heavy Dependencies`        — ranked by outbound `calls` count
 *   3. `## Circular Dependencies`     — Tarjan SCC clusters, or "None identified"
 *   4. `## External Dependencies & Configured Connectors` — per-service external
 *      sources table with cross-link to integrations.md (Option A non-overlap)
 *
 * No frontmatter is emitted — that is the D5 CLI's responsibility.
 * No port section — ServiceInventory does not expose per-service port data.
 */
export function renderServiceDependencies(graph, inventory) {
    // ── 1. Most Depended Services ─────────────────────────────────────────
    const inbound = rankInbound(graph).filter((r) => !isSyntheticDep(r.service));
    const mostDependedRows = inbound.map((r, i) => `| ${i + 1} | ${r.service} | ${r.count} |`);
    const mostDependedTable = [
        "| Rank | Service | Inbound Calls |",
        "|---|---|---|",
        ...(mostDependedRows.length > 0 ? mostDependedRows : ["| — | — | — |"]),
    ].join("\n");
    // ── 2. Heavy Dependencies (outbound calls) ────────────────────────────
    const outboundCounts = new Map();
    for (const e of graph.edges) {
        if (e.kind === "calls" &&
            !isSyntheticDep(e.from_service) &&
            !isSyntheticDep(e.to_service)) {
            outboundCounts.set(e.from_service, (outboundCounts.get(e.from_service) ?? 0) + 1);
        }
    }
    const heavyRows = [...outboundCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([svc, count]) => `| ${svc} | ${count} |`);
    const heavyTable = [
        "| Service | Outbound Calls |",
        "|---|---|",
        ...(heavyRows.length > 0 ? heavyRows : ["| — | — |"]),
    ].join("\n");
    // ── 3. Circular Dependencies ──────────────────────────────────────────
    const cycles = detectCycles(graph);
    let circularSection;
    if (cycles.length === 0) {
        circularSection = "None identified.";
    }
    else {
        circularSection = cycles
            .map((cluster) => `- Cycle: ${cluster.join(" → ")}`)
            .join("\n");
    }
    // ── 4. External Dependencies & Configured Connectors ─────────────────
    const extRows = [];
    for (const svc of [...(inventory.services ?? [])].sort((a, b) => a.identity.id.localeCompare(b.identity.id))) {
        const sources = [...(svc.external_sources ?? [])].sort((a, b) => a.kind.localeCompare(b.kind));
        for (const src of sources) {
            const system = src.detail
                ? `${src.kind} (${src.detail})`
                : src.kind;
            const connector = src.connector_id ?? "—";
            const configured = src.configured ? "✓" : "—";
            extRows.push(`| ${svc.identity.id} | ${system} | ${connector} | ${configured} |`);
        }
    }
    const extTable = [
        "| Service | External System | Connector | Configured |",
        "|---|---|---|---|",
        ...(extRows.length > 0 ? extRows : ["| — | — | — | — |"]),
    ].join("\n");
    const extCrossLink = "> Connector setup and credential configuration live in [integrations.md](integrations.md); this view is the code-derived per-service dependency map.";
    // ── Assemble ──────────────────────────────────────────────────────────
    return [
        "## Most Depended Services",
        "",
        mostDependedTable,
        "",
        "## Heavy Dependencies",
        "",
        heavyTable,
        "",
        "## Circular Dependencies",
        "",
        circularSection,
        "",
        "## External Dependencies & Configured Connectors",
        "",
        extTable,
        "",
        extCrossLink,
    ].join("\n");
}
// ── Content predicates ──────────────────────────────────────────────
/**
 * Count the "real" deployable services in a list of discovered identities —
 * excluding synthetic nodes (`ext:`/`queue:`/`table:`/`auth:`) AND library
 * nodes (a lib is a dependency, not a topology service). Shares the exact
 * predicate {@link hasServiceTopology} uses for its node-count check, so the
 * inventory's cross-service AUTO decision, the page renderer's no-scaffolding
 * gate, and the orchestrator's cost estimate all agree on what "a service" is.
 *
 * `>= 2` is the AUTO threshold: a repo with two or more real services gets
 * cross-service docs even without the `--cross-service` flag.
 */
export function countRealServices(identities) {
    return identities.filter((i) => !isSynthetic(i.id) && i.kind !== "library").length;
}
/**
 * Returns true when there is enough data to emit a meaningful service-map or
 * service-dependencies page: either ≥2 real (non-synthetic) services in the
 * graph, OR ≥1 calls edge between two real services. A service map listing
 * two or more real services is true information worth emitting even before any
 * call edges are detected.
 */
export function hasServiceTopology(graph) {
    // Real deployable services only: exclude synthetic nodes AND library nodes
    // (a lib is a dependency, not a topology service). Used for BOTH the count
    // and the calls-edge check, so a library→service calls edge can never make
    // a 1-service graph emit a service map.
    const realServiceIds = new Set(graph.services.filter((s) => !isSynthetic(s.id) && s.kind !== "library").map((s) => s.id));
    // ≥2 real services is enough — the service list alone is genuine information.
    if (realServiceIds.size >= 2)
        return true;
    // Otherwise require a direct calls edge between two real (non-library) services.
    return graph.edges.some((e) => e.kind === "calls" &&
        realServiceIds.has(e.from_service) &&
        realServiceIds.has(e.to_service));
}
/**
 * Returns true when the inventory has ≥1 HTTP client callsite across any
 * service — i.e. there is something substantive to show in client-registry.
 */
export function hasClientData(graph) {
    return graph.edges.some((e) => e.kind === "calls" &&
        !isSynthetic(e.from_service) &&
        !isSynthetic(e.to_service));
}
/**
 * Returns true when there is ≥1 produces or consumes edge involving a
 * `queue:` synthetic node — i.e. there are actual queues to register.
 */
export function hasQueueData(graph) {
    return graph.edges.some((e) => (e.kind === "produces" && e.to_service.startsWith("queue:")) ||
        (e.kind === "consumes" && e.from_service.startsWith("queue:")));
}
/**
 * Returns true when ≥1 service in the inventory has ORM entities — i.e.
 * there are DB traces worth documenting.
 */
export function hasDbTraces(inventory) {
    return (inventory.services ?? []).some((svc) => (svc.orm_entities ?? []).length > 0);
}
/**
 * Returns true when ≥1 library node in the graph has `depends_on` edges
 * from two or more different (non-synthetic) services — i.e. there are
 * genuinely *shared* libraries.
 */
export function hasSharedLibraries(graph) {
    const consumersPerLib = new Map();
    for (const e of graph.edges) {
        if (e.kind !== "depends_on" || isSynthetic(e.from_service))
            continue;
        const set = consumersPerLib.get(e.to_service) ?? new Set();
        set.add(e.from_service);
        consumersPerLib.set(e.to_service, set);
    }
    return [...consumersPerLib.values()].some((consumers) => consumers.size >= 2);
}
// ── D5: write helpers + CLI ─────────────────────────────────────────
/**
 * The six wiki slugs owned by the cross-service renderer. Single source of
 * truth for both {@link writeCrossServicePages} (which writes/prunes per
 * content predicate) and {@link pruneCrossServicePages} (which removes all six
 * when cross-service is turned off). Keeping one list prevents a slug being
 * rendered but never pruned (or vice versa).
 */
export const CROSS_SERVICE_SLUGS = [
    "service-map",
    "service-dependencies",
    "client-registry",
    "queue-registry",
    "database-traces",
    "shared-libraries",
];
/**
 * Wrap a rendered body with atlas YAML frontmatter.
 * `atlas_facet: architecture` → default `audience: contributor` (compilation.md table).
 */
function _withFrontmatter(title, body, sources, atlasRunId, slug) {
    const sourceLines = sources.length > 0
        ? sources.map((s) => `  - ${s}`)
        : ["  []"];
    const fm = [
        "---",
        `title: ${title}`,
        "atlas_facet: architecture",
        `atlas_run_id: ${atlasRunId}`,
        `cross_service_page: ${slug}`,
        "audience: contributor",
        "sources:",
        ...sourceLines,
        "generated_by: cross_service_pages",
        "---",
        "",
    ].join("\n");
    return fm + body.trimStart() + "\n";
}
/**
 * True when the markdown file at `absPath` is a doc-wiki-generated cross-service
 * page — i.e. its frontmatter carries the ownership marker this renderer stamps
 * (`cross_service_page: <slug>` or `generated_by: cross_service_pages`).
 *
 * Used to gate BOTH deletion paths so a *user-authored* page that merely
 * collides on filename (e.g. someone hand-wrote `wiki/service-map.md`) is never
 * deleted when cross-service is turned off or a slug loses its data. A missing
 * file or one without the marker returns false (do not delete).
 */
function _isGeneratedCrossServicePage(absPath) {
    let content;
    try {
        content = fs.readFileSync(absPath, "utf-8");
    }
    catch {
        return false; // unreadable / missing → treat as not-ours, don't delete
    }
    const { frontmatter } = parseFrontmatter(content);
    if (!frontmatter)
        return false;
    return ("cross_service_page" in frontmatter ||
        frontmatter["generated_by"] === "cross_service_pages");
}
/**
 * Render + write cross-service pages under `<wikiRoot>/wiki/`.
 * Only pages with substantive content are emitted — pages whose predicate
 * returns false are silently skipped (no file written, not included in the
 * returned array). Returns the absolute paths actually written, in
 * deterministic order.
 *
 * When no page has content (e.g. a plain monorepo with no cross-service
 * structure), the returned array is empty and nothing is written to disk.
 */
export function writeCrossServicePages(wikiRoot, inventory, graph) {
    const outDir = path.join(wikiRoot, "wiki");
    // Collect unique evidence files from the graph edges as source provenance.
    const evidence = [
        ...new Set(graph.edges
            .map((e) => e.evidence_file ?? "")
            .filter((f) => f.length > 0)),
    ].sort();
    const serviceTopology = hasServiceTopology(graph);
    const pages = [
        { slug: "service-map", title: "Service Map", hasContent: serviceTopology, render: () => renderServiceMap(graph, inventory) },
        { slug: "service-dependencies", title: "Service Dependencies", hasContent: serviceTopology, render: () => renderServiceDependencies(graph, inventory) },
        { slug: "client-registry", title: "Service Client Registry", hasContent: hasClientData(graph), render: () => renderClientRegistry(graph, inventory) },
        { slug: "queue-registry", title: "Message Queue Registry", hasContent: hasQueueData(graph), render: () => renderQueueRegistry(graph, inventory) },
        { slug: "database-traces", title: "Database Traces", hasContent: hasDbTraces(inventory), render: () => renderDbTraces(inventory) },
        { slug: "shared-libraries", title: "Shared Libraries", hasContent: hasSharedLibraries(graph), render: () => renderSharedLibraryMatrix(graph, inventory) },
    ];
    // Write pages that have real content; DELETE any stale page a prior run left behind
    // (e.g. a refresh where the graph no longer has queue edges must remove the old
    // queue-registry.md, never leave outdated cross-service data exposed in the wiki).
    if (pages.some((pg) => pg.hasContent))
        fs.mkdirSync(outDir, { recursive: true });
    const written = [];
    const removed = [];
    for (const pg of pages) {
        const target = path.join(outDir, `${pg.slug}.md`);
        if (pg.hasContent) {
            fs.writeFileSync(target, _withFrontmatter(pg.title, pg.render(), evidence, inventory.atlas_run_id, pg.slug));
            written.push(target);
        }
        else if (fs.existsSync(target) && _isGeneratedCrossServicePage(target)) {
            // Only delete a stale page WE generated — never a user-authored file that
            // happens to share the slug name (e.g. a hand-written wiki/service-map.md).
            fs.rmSync(target);
            removed.push(target);
        }
    }
    if (written.length === 0) {
        process.stderr.write("[cross_service_pages] no cross-service structure detected; no pages written\n");
    }
    if (removed.length > 0) {
        process.stderr.write(`[cross_service_pages] removed ${removed.length} stale page(s): ${removed.map((p) => path.basename(p)).join(", ")}\n`);
    }
    return written;
}
/**
 * Remove the doc-wiki-generated cross-service pages (the {@link CROSS_SERVICE_SLUGS}
 * slugs) from `<wikiRoot>/wiki/`. Used when cross-service resolves OFF (e.g. the
 * user passed `--no-cross-service`, or the repo dropped below 2 services) so a
 * prior run's pages don't linger as stale, misleading content.
 *
 * Ownership-guarded: a slug file is deleted ONLY when its frontmatter carries
 * the renderer's marker ({@link _isGeneratedCrossServicePage}). A user-authored
 * page that merely shares the slug name (e.g. a hand-written
 * `wiki/service-map.md`) is left untouched — turning cross-service off must
 * never destroy user content.
 *
 * Unlike {@link writeCrossServicePages}, this does NOT need an inventory or a
 * service graph. Idempotent: a missing (or unmarked) file is a no-op. Returns
 * the absolute paths actually removed, in deterministic slug order.
 */
export function pruneCrossServicePages(wikiRoot) {
    const outDir = path.join(wikiRoot, "wiki");
    const removed = [];
    for (const slug of CROSS_SERVICE_SLUGS) {
        const target = path.join(outDir, `${slug}.md`);
        if (fs.existsSync(target) && _isGeneratedCrossServicePage(target)) {
            fs.rmSync(target);
            removed.push(target);
        }
    }
    if (removed.length > 0) {
        process.stderr.write(`[cross_service_pages] pruned ${removed.length} cross-service page(s) (cross-service off): ${removed.map((p) => path.basename(p)).join(", ")}\n`);
    }
    return removed;
}
// ── CLI ─────────────────────────────────────────────────────────────
const _CSP_FLAG_SPEC = {
    "--wiki-root": "wikiRoot",
    "--run-id": "runId",
};
const _CSP_RUN_ID_RE = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/;
const _CSP_HELP = `usage: cross_service_pages.js <render|prune> --wiki-root <p> [--run-id <id>]

render  Write the six cross-service wiki pages from a persisted inventory +
        service graph (prunes any slug whose data disappeared).
  --wiki-root <p>   Wiki root (where outputs/atlas/<run-id>/ and wiki/ live)
  --run-id <id>     Atlas run id (YYYY-MM-DDTHH-MM-SS)
  Stdout: JSON array of absolute paths written.

prune   Remove ALL six cross-service pages from <wiki-root>/wiki/ (used when
        cross-service resolves OFF, e.g. --no-cross-service or a monolith).
        Needs no inventory/graph; idempotent.
  --wiki-root <p>   Wiki root (where wiki/ lives)
  Stdout: JSON array of absolute paths removed.
`;
export function main(argv = process.argv.slice(2)) {
    if (argv.length === 0 || argv[0] === "-h" || argv[0] === "--help") {
        process.stdout.write(_CSP_HELP);
        return 0;
    }
    const sub = argv[0];
    if (sub !== "render" && sub !== "prune") {
        process.stderr.write(`unknown subcommand: ${argv[0]}\n`);
        return 2;
    }
    let parsed;
    try {
        parsed = parseFlags(argv.slice(1), _CSP_FLAG_SPEC);
    }
    catch (e) {
        process.stderr.write(`${e.message}\n`);
        return 2;
    }
    if (parsed.help) {
        process.stdout.write(_CSP_HELP);
        return 0;
    }
    const wikiRoot = parsed.values["wikiRoot"];
    if (typeof wikiRoot !== "string" || wikiRoot.length === 0) {
        process.stderr.write("--wiki-root is required\n");
        return 2;
    }
    // prune: no inventory/graph/run-id needed — just remove the six slugs.
    if (sub === "prune") {
        const removed = pruneCrossServicePages(wikiRoot);
        process.stdout.write(JSON.stringify(removed) + "\n");
        return 0;
    }
    const runId = parsed.values["runId"];
    if (typeof runId !== "string" || !_CSP_RUN_ID_RE.test(runId)) {
        process.stderr.write("--run-id is required and must match YYYY-MM-DDTHH-MM-SS\n");
        return 2;
    }
    const inventory = loadInventory(wikiRoot, runId);
    if (!inventory) {
        process.stderr.write(`no code-inventory.json for run ${runId} under ${wikiRoot}\n`);
        return 1;
    }
    const graph = loadServiceGraph(wikiRoot, runId);
    if (!graph) {
        process.stderr.write(`no service-graph.json for run ${runId} under ${wikiRoot}\n`);
        return 1;
    }
    let written;
    try {
        written = writeCrossServicePages(wikiRoot, inventory, graph);
    }
    catch (e) {
        process.stderr.write(`write failed: ${e.message}\n`);
        return 1;
    }
    process.stdout.write(JSON.stringify(written) + "\n");
    return 0;
}
const _cspThisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === _cspThisFile) {
    process.exit(main());
}
