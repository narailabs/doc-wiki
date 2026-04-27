import { formatErDiagram, formatGraph, } from "./mermaid_format.js";
// ── Per-connector transformers ────────────────────────────────────────
//
// Each function takes the raw envelope (parsed JSON object, the same shape
// the connector CLI prints to stdout) and returns a MermaidBlock or
// undefined. When a connector's action set changes, update the matching
// transformer here; this is the single site for wiki-side decoration.
function mermaidForAws(result) {
    if (result["status"] !== "success")
        return undefined;
    const action = result["action"];
    const data = result["data"];
    if (data === undefined)
        return undefined;
    if (action === "list_functions") {
        const fns = data["functions"] ?? [];
        if (fns.length === 0)
            return undefined;
        const region = data["region"] || "region";
        const nodes = [
            { id: `region_${region}`, label: `Region: ${region}`, shape: "rounded" },
            ...fns.map((f) => ({
                id: `fn_${f.name}`,
                label: `${f.name} (${f.runtime || "unknown"})`,
            })),
        ];
        const edges = fns.map((f) => ({
            from: `region_${region}`,
            to: `fn_${f.name}`,
        }));
        return formatGraph("TB", `AWS Lambda Functions — ${region}`, nodes, edges);
    }
    if (action === "describe_db") {
        const region = data["region"] || "region";
        const id = data["db_identifier"] || "db";
        const engine = data["engine"] || "";
        const cls = data["instance_class"] || "";
        const label = engine || cls ? `${id} (${engine}${cls ? `, ${cls}` : ""})` : id;
        const nodes = [
            { id: `region_${region}`, label: `Region: ${region}`, shape: "rounded" },
            { id: `db_${id}`, label, shape: "stadium" },
        ];
        const edges = [{ from: `region_${region}`, to: `db_${id}` }];
        return formatGraph("TB", `AWS RDS — ${id}`, nodes, edges);
    }
    if (action === "list_buckets") {
        const buckets = data["buckets"] ?? [];
        if (buckets.length === 0)
            return undefined;
        const nodes = [
            { id: "account", label: "AWS Account", shape: "rounded" },
            ...buckets.map((b) => ({ id: `bucket_${b.name}`, label: b.name })),
        ];
        const edges = buckets.map((b) => ({
            from: "account",
            to: `bucket_${b.name}`,
        }));
        return formatGraph("TB", "AWS S3 Buckets", nodes, edges);
    }
    return undefined;
}
function mermaidForGcp(result) {
    if (result["status"] !== "success")
        return undefined;
    const action = result["action"];
    const data = result["data"];
    if (data === undefined)
        return undefined;
    if (action === "list_services") {
        const services = data["services"] ?? [];
        if (services.length === 0)
            return undefined;
        const project = data["project_id"] || "project";
        const nodes = [
            { id: `proj_${project}`, label: `Project: ${project}`, shape: "rounded" },
            ...services.map((s, i) => ({ id: `svc_${i}`, label: s.title || s.name })),
        ];
        const edges = services.map((_, i) => ({
            from: `proj_${project}`,
            to: `svc_${i}`,
        }));
        return formatGraph("TB", `GCP Services — ${project}`, nodes, edges);
    }
    if (action === "describe_db") {
        const project = data["project_id"] || "project";
        const instance = data["instance_id"] || "instance";
        const engine = data["engine"] || "";
        const version = data["version"] || "";
        const label = engine || version ? `${instance} (${engine}${version ? ` ${version}` : ""})` : instance;
        const nodes = [
            { id: `proj_${project}`, label: `Project: ${project}`, shape: "rounded" },
            { id: `db_${instance}`, label, shape: "stadium" },
        ];
        const edges = [{ from: `proj_${project}`, to: `db_${instance}` }];
        return formatGraph("TB", `GCP Cloud SQL — ${instance}`, nodes, edges);
    }
    if (action === "list_topics") {
        const topics = data["topics"] ?? [];
        if (topics.length === 0)
            return undefined;
        const project = data["project_id"] || "project";
        const nodes = [
            { id: `proj_${project}`, label: `Project: ${project}`, shape: "rounded" },
            ...topics.map((t, i) => ({ id: `topic_${i}`, label: t })),
        ];
        const edges = topics.map((_, i) => ({
            from: `proj_${project}`,
            to: `topic_${i}`,
        }));
        return formatGraph("TB", `GCP Pub/Sub Topics — ${project}`, nodes, edges);
    }
    return undefined;
}
function mermaidForJira(result) {
    if (result["status"] !== "success")
        return undefined;
    if (result["action"] !== "jql_search")
        return undefined;
    const data = result["data"];
    if (data === undefined)
        return undefined;
    const issues = data["issues"] ?? [];
    if (issues.length === 0)
        return undefined;
    const byStatus = new Map();
    for (const issue of issues) {
        const status = (issue["status"] ?? "unknown") || "unknown";
        let bucket = byStatus.get(status);
        if (bucket === undefined) {
            bucket = [];
            byStatus.set(status, bucket);
        }
        bucket.push(issue);
    }
    const nodes = [];
    const edges = [];
    nodes.push({ id: "root", label: "Issues", shape: "rounded" });
    let si = 0;
    let ii = 0;
    const PER_DIAGRAM_CAP = 40;
    let drawn = 0;
    for (const [status, bucket] of byStatus) {
        if (drawn >= PER_DIAGRAM_CAP)
            break;
        const sid = `s${si++}`;
        nodes.push({ id: sid, label: status });
        edges.push({ from: "root", to: sid });
        for (const issue of bucket) {
            if (drawn >= PER_DIAGRAM_CAP)
                break;
            const key = issue["key"] ?? `I${ii}`;
            const summary = (issue["summary"] ?? "").slice(0, 40);
            const label = summary ? `${key}: ${summary}` : key;
            const id = `i${ii++}`;
            nodes.push({ id, label });
            edges.push({ from: sid, to: id });
            drawn++;
        }
    }
    return formatGraph("TB", "Issue Status Tree", nodes, edges);
}
function mermaidForConfluence(result) {
    if (result["status"] !== "success")
        return undefined;
    const action = result["action"];
    const data = result["data"];
    if (data === undefined)
        return undefined;
    if (action === "cql_search") {
        const pages = data["pages"] ?? [];
        if (pages.length === 0)
            return undefined;
        const spaceKeys = new Set(pages
            .map((p) => p["space_key"] ?? "")
            .filter((k) => k.length > 0));
        const nodes = [];
        const edges = [];
        const capped = pages.slice(0, 30);
        if (spaceKeys.size <= 1) {
            const root = [...spaceKeys][0] ?? "Results";
            nodes.push({ id: "space", label: root, shape: "rounded" });
            for (const [i, p] of capped.entries()) {
                const title = (p["title"] ?? `page ${i}`).slice(0, 60);
                nodes.push({ id: `p${i}`, label: title });
                edges.push({ from: "space", to: `p${i}` });
            }
        }
        else {
            const spaceIdx = new Map();
            let si = 0;
            for (const k of spaceKeys) {
                const id = `s${si++}`;
                spaceIdx.set(k, id);
                nodes.push({ id, label: k, shape: "rounded" });
            }
            for (const [i, p] of capped.entries()) {
                const key = p["space_key"] ?? "";
                const parent = spaceIdx.get(key);
                if (parent === undefined)
                    continue;
                const title = (p["title"] ?? `page ${i}`).slice(0, 60);
                nodes.push({ id: `p${i}`, label: title });
                edges.push({ from: parent, to: `p${i}` });
            }
        }
        return formatGraph("TB", "Page Hierarchy", nodes, edges);
    }
    if (action === "get_page") {
        const spaceKey = data["space_key"] ?? "";
        const title = (data["title"] ?? "page").slice(0, 60);
        if (title.length === 0)
            return undefined;
        const nodes = [];
        const edges = [];
        if (spaceKey.length > 0) {
            nodes.push({ id: "space", label: spaceKey, shape: "rounded" });
            nodes.push({ id: "page", label: title });
            edges.push({ from: "space", to: "page" });
        }
        else {
            nodes.push({ id: "page", label: title });
        }
        return formatGraph("TB", "Page Hierarchy", nodes, edges);
    }
    return undefined;
}
function mermaidForNotion(result) {
    if (result["status"] !== "success")
        return undefined;
    const action = result["action"];
    const data = result["data"];
    if (data === undefined)
        return undefined;
    if (action === "search") {
        const results = data["results"] ?? [];
        if (results.length === 0)
            return undefined;
        const capped = results.slice(0, 30);
        const nodes = [
            { id: "root", label: "Search Results", shape: "rounded" },
        ];
        const edges = [];
        for (const [i, r] of capped.entries()) {
            const id = (r["id"] ?? `r${i}`).slice(0, 8);
            const objType = (r["object_type"] ?? "page").slice(0, 20);
            nodes.push({ id: `r${i}`, label: `${objType} ${id}` });
            edges.push({ from: "root", to: `r${i}` });
        }
        return formatGraph("TB", "Notion Search Hierarchy", nodes, edges);
    }
    if (action === "query_database") {
        const databaseId = data["database_id"] ?? "database";
        const results = data["results"] ?? [];
        if (results.length === 0)
            return undefined;
        const capped = results.slice(0, 30);
        const dbLabel = databaseId.length > 8 ? databaseId.slice(0, 8) + "…" : databaseId;
        const nodes = [
            { id: "db", label: `DB ${dbLabel}`, shape: "rounded" },
        ];
        const edges = [];
        for (const [i, r] of capped.entries()) {
            const title = (r["title"] ?? `row ${i}`).slice(0, 60);
            nodes.push({ id: `p${i}`, label: title });
            edges.push({ from: "db", to: `p${i}` });
        }
        return formatGraph("TB", "Notion Page Tree", nodes, edges);
    }
    return undefined;
}
function parsePackageJsonDeps(content) {
    try {
        const parsed = JSON.parse(content);
        const deps = [
            ...Object.keys(parsed.dependencies ?? {}),
            ...Object.keys(parsed.devDependencies ?? {}),
        ];
        return [...new Set(deps)];
    }
    catch {
        return [];
    }
}
function parseRequirementsTxt(content) {
    const deps = [];
    const seen = new Set();
    for (const rawLine of content.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (line === "" || line.startsWith("#"))
            continue;
        const m = line.match(/^([A-Za-z0-9_.\-]+)/);
        if (!m)
            continue;
        const name = m[1];
        if (seen.has(name))
            continue;
        seen.add(name);
        deps.push(name);
    }
    return deps;
}
function mermaidForGithub(result) {
    if (result["status"] !== "success")
        return undefined;
    if (result["action"] !== "get_file")
        return undefined;
    const data = result["data"];
    if (data === undefined)
        return undefined;
    const filePath = (data["path"] ?? "").toLowerCase();
    const content = data["content"] ?? "";
    if (content === "")
        return undefined;
    let deps = [];
    if (filePath.endsWith("package.json")) {
        deps = parsePackageJsonDeps(content);
    }
    else if (filePath.endsWith("requirements.txt")) {
        deps = parseRequirementsTxt(content);
    }
    if (deps.length === 0)
        return undefined;
    const capped = deps.slice(0, 40);
    const rootLabel = data["path"] || "repo";
    const nodes = [
        { id: "root", label: rootLabel, shape: "rounded" },
        ...capped.map((d, i) => ({ id: `dep_${i}`, label: d })),
    ];
    const edges = capped.map((_, i) => ({
        from: "root",
        to: `dep_${i}`,
    }));
    return formatGraph("LR", "Dependency Graph", nodes, edges);
}
function mermaidForDb(result) {
    // db-agent uses `status: "ok"` instead of `success`, and emits the
    // schema action's `tables` array at top level rather than nested in `data`.
    if (result["status"] !== "ok")
        return undefined;
    const tables = result["tables"];
    if (!Array.isArray(tables) || tables.length === 0)
        return undefined;
    const wrapped = tables;
    const ermTables = wrapped.map((t) => {
        const cols = t.columns.map((c) => {
            const col = {
                name: c.name,
                type: c.data_type || "string",
            };
            if (c.is_primary_key)
                col.key = "PK";
            return col;
        });
        return { name: t.name, columns: cols };
    });
    return formatErDiagram("Database Schema", ermTables, []);
}
const TRANSFORMERS = {
    aws: mermaidForAws,
    gcp: mermaidForGcp,
    jira: mermaidForJira,
    confluence: mermaidForConfluence,
    notion: mermaidForNotion,
    github: mermaidForGithub,
    db: mermaidForDb,
};
// ── Public API ────────────────────────────────────────────────────────
/**
 * Apply a wiki Mermaid block on top of a `DispatchResult.envelope` when the
 * connector + action + payload qualify. Returns a fresh `DispatchResult` with
 * the augmented envelope. Returns the input unchanged for:
 *  - error results (no envelope to augment),
 *  - non-object envelopes,
 *  - unknown connector short names (no transformer registered),
 *  - actions that don't produce diagram-worthy data.
 *
 * Never throws — mirrors wrappers' permissive contract.
 */
export function applyMermaid(result) {
    if (result.error !== undefined)
        return result;
    const envelope = result.envelope;
    if (envelope === null || typeof envelope !== "object")
        return result;
    const transformer = TRANSFORMERS[result.connector];
    if (transformer === undefined)
        return result;
    const env = envelope;
    const mermaid = transformer(env);
    if (mermaid === undefined)
        return result;
    return {
        ...result,
        envelope: { ...env, mermaid },
    };
}
/** Connector short names this module knows how to augment. Used by tests
 *  and any caller that wants to filter to structural-action connectors. */
export const SUPPORTED_CONNECTORS = new Set(Object.keys(TRANSFORMERS));
