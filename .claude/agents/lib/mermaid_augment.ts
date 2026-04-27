/**
 * mermaid_augment.ts — wiki-side Mermaid augmentation for raw connector envelopes.
 *
 * Used by the wiki ingest pipeline (SKILL.md step 7). After
 * `@narai/connector-hub`'s `gather()` dispatches connector CLIs in parallel
 * and returns raw `DispatchResult` entries, this module applies the
 * wiki-specific Mermaid diagram block (`mermaid: { type, title, code }`) on
 * top of structural-action envelopes.
 *
 * Single decoration site for all 7 builtin connectors (aws, gcp, jira,
 * confluence, notion, github, db). The legacy `wiki-<svc>-agent/scripts/*_wrapper.ts`
 * scripts that previously held this logic were decommissioned — they only duplicated
 * what the hub does (CLI dispatch) plus what this module does (Mermaid).
 *
 * Public API:
 *   applyMermaid(result: DispatchResult): DispatchResult
 *     - Returns a *new* `DispatchResult` whose `envelope` has been augmented
 *       with a `mermaid` block when the connector + action + payload qualify.
 *     - When the envelope cannot be augmented (error result, non-structural
 *       action, empty data, unknown connector), the input is returned as-is.
 *     - Never throws; permissive on malformed data.
 */
import type { DispatchResult } from "@narai/connector-hub";

import {
  formatErDiagram,
  formatGraph,
  type ErColumn,
  type ErTable,
  type GraphEdge,
  type GraphNode,
  type MermaidBlock,
} from "./mermaid_format.js";

// ── Per-connector transformers ────────────────────────────────────────
//
// Each function takes the raw envelope (parsed JSON object, the same shape
// the connector CLI prints to stdout) and returns a MermaidBlock or
// undefined. When a connector's action set changes, update the matching
// transformer here; this is the single site for wiki-side decoration.

function mermaidForAws(result: Record<string, unknown>): MermaidBlock | undefined {
  if (result["status"] !== "success") return undefined;
  const action = result["action"];
  const data = result["data"] as Record<string, unknown> | undefined;
  if (data === undefined) return undefined;

  if (action === "list_functions") {
    const fns =
      (data["functions"] as Array<{ name: string; runtime: string }> | undefined) ?? [];
    if (fns.length === 0) return undefined;
    const region = (data["region"] as string) || "region";
    const nodes: GraphNode[] = [
      { id: `region_${region}`, label: `Region: ${region}`, shape: "rounded" },
      ...fns.map((f) => ({
        id: `fn_${f.name}`,
        label: `${f.name} (${f.runtime || "unknown"})`,
      })),
    ];
    const edges: GraphEdge[] = fns.map((f) => ({
      from: `region_${region}`,
      to: `fn_${f.name}`,
    }));
    return formatGraph("TB", `AWS Lambda Functions — ${region}`, nodes, edges);
  }

  if (action === "describe_db") {
    const region = (data["region"] as string) || "region";
    const id = (data["db_identifier"] as string) || "db";
    const engine = (data["engine"] as string) || "";
    const cls = (data["instance_class"] as string) || "";
    const label = engine || cls ? `${id} (${engine}${cls ? `, ${cls}` : ""})` : id;
    const nodes: GraphNode[] = [
      { id: `region_${region}`, label: `Region: ${region}`, shape: "rounded" },
      { id: `db_${id}`, label, shape: "stadium" },
    ];
    const edges: GraphEdge[] = [{ from: `region_${region}`, to: `db_${id}` }];
    return formatGraph("TB", `AWS RDS — ${id}`, nodes, edges);
  }

  if (action === "list_buckets") {
    const buckets = (data["buckets"] as Array<{ name: string }> | undefined) ?? [];
    if (buckets.length === 0) return undefined;
    const nodes: GraphNode[] = [
      { id: "account", label: "AWS Account", shape: "rounded" },
      ...buckets.map((b) => ({ id: `bucket_${b.name}`, label: b.name })),
    ];
    const edges: GraphEdge[] = buckets.map((b) => ({
      from: "account",
      to: `bucket_${b.name}`,
    }));
    return formatGraph("TB", "AWS S3 Buckets", nodes, edges);
  }

  return undefined;
}

function mermaidForGcp(result: Record<string, unknown>): MermaidBlock | undefined {
  if (result["status"] !== "success") return undefined;
  const action = result["action"];
  const data = result["data"] as Record<string, unknown> | undefined;
  if (data === undefined) return undefined;

  if (action === "list_services") {
    const services =
      (data["services"] as Array<{ name: string; title: string }> | undefined) ?? [];
    if (services.length === 0) return undefined;
    const project = (data["project_id"] as string) || "project";
    const nodes: GraphNode[] = [
      { id: `proj_${project}`, label: `Project: ${project}`, shape: "rounded" },
      ...services.map((s, i) => ({ id: `svc_${i}`, label: s.title || s.name })),
    ];
    const edges: GraphEdge[] = services.map((_, i) => ({
      from: `proj_${project}`,
      to: `svc_${i}`,
    }));
    return formatGraph("TB", `GCP Services — ${project}`, nodes, edges);
  }

  if (action === "describe_db") {
    const project = (data["project_id"] as string) || "project";
    const instance = (data["instance_id"] as string) || "instance";
    const engine = (data["engine"] as string) || "";
    const version = (data["version"] as string) || "";
    const label = engine || version ? `${instance} (${engine}${version ? ` ${version}` : ""})` : instance;
    const nodes: GraphNode[] = [
      { id: `proj_${project}`, label: `Project: ${project}`, shape: "rounded" },
      { id: `db_${instance}`, label, shape: "stadium" },
    ];
    const edges: GraphEdge[] = [{ from: `proj_${project}`, to: `db_${instance}` }];
    return formatGraph("TB", `GCP Cloud SQL — ${instance}`, nodes, edges);
  }

  if (action === "list_topics") {
    const topics = (data["topics"] as string[] | undefined) ?? [];
    if (topics.length === 0) return undefined;
    const project = (data["project_id"] as string) || "project";
    const nodes: GraphNode[] = [
      { id: `proj_${project}`, label: `Project: ${project}`, shape: "rounded" },
      ...topics.map((t, i) => ({ id: `topic_${i}`, label: t })),
    ];
    const edges: GraphEdge[] = topics.map((_, i) => ({
      from: `proj_${project}`,
      to: `topic_${i}`,
    }));
    return formatGraph("TB", `GCP Pub/Sub Topics — ${project}`, nodes, edges);
  }

  return undefined;
}

function mermaidForJira(result: Record<string, unknown>): MermaidBlock | undefined {
  if (result["status"] !== "success") return undefined;
  if (result["action"] !== "jql_search") return undefined;
  const data = result["data"] as Record<string, unknown> | undefined;
  if (data === undefined) return undefined;
  const issues =
    (data["issues"] as Array<Record<string, unknown>> | undefined) ?? [];
  if (issues.length === 0) return undefined;

  const byStatus = new Map<string, Array<Record<string, unknown>>>();
  for (const issue of issues) {
    const status = ((issue["status"] as string | undefined) ?? "unknown") || "unknown";
    let bucket = byStatus.get(status);
    if (bucket === undefined) {
      bucket = [];
      byStatus.set(status, bucket);
    }
    bucket.push(issue);
  }

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  nodes.push({ id: "root", label: "Issues", shape: "rounded" });
  let si = 0;
  let ii = 0;
  const PER_DIAGRAM_CAP = 40;
  let drawn = 0;
  for (const [status, bucket] of byStatus) {
    if (drawn >= PER_DIAGRAM_CAP) break;
    const sid = `s${si++}`;
    nodes.push({ id: sid, label: status });
    edges.push({ from: "root", to: sid });
    for (const issue of bucket) {
      if (drawn >= PER_DIAGRAM_CAP) break;
      const key = (issue["key"] as string | undefined) ?? `I${ii}`;
      const summary = ((issue["summary"] as string | undefined) ?? "").slice(0, 40);
      const label = summary ? `${key}: ${summary}` : key;
      const id = `i${ii++}`;
      nodes.push({ id, label });
      edges.push({ from: sid, to: id });
      drawn++;
    }
  }
  return formatGraph("TB", "Issue Status Tree", nodes, edges);
}

function mermaidForConfluence(result: Record<string, unknown>): MermaidBlock | undefined {
  if (result["status"] !== "success") return undefined;
  const action = result["action"];
  const data = result["data"] as Record<string, unknown> | undefined;
  if (data === undefined) return undefined;

  if (action === "cql_search") {
    const pages = (data["pages"] as Array<Record<string, unknown>> | undefined) ?? [];
    if (pages.length === 0) return undefined;
    const spaceKeys = new Set(
      pages
        .map((p) => (p["space_key"] as string | undefined) ?? "")
        .filter((k) => k.length > 0),
    );
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const capped = pages.slice(0, 30);
    if (spaceKeys.size <= 1) {
      const root = [...spaceKeys][0] ?? "Results";
      nodes.push({ id: "space", label: root, shape: "rounded" });
      for (const [i, p] of capped.entries()) {
        const title = ((p["title"] as string | undefined) ?? `page ${i}`).slice(0, 60);
        nodes.push({ id: `p${i}`, label: title });
        edges.push({ from: "space", to: `p${i}` });
      }
    } else {
      const spaceIdx = new Map<string, string>();
      let si = 0;
      for (const k of spaceKeys) {
        const id = `s${si++}`;
        spaceIdx.set(k, id);
        nodes.push({ id, label: k, shape: "rounded" });
      }
      for (const [i, p] of capped.entries()) {
        const key = (p["space_key"] as string | undefined) ?? "";
        const parent = spaceIdx.get(key);
        if (parent === undefined) continue;
        const title = ((p["title"] as string | undefined) ?? `page ${i}`).slice(0, 60);
        nodes.push({ id: `p${i}`, label: title });
        edges.push({ from: parent, to: `p${i}` });
      }
    }
    return formatGraph("TB", "Page Hierarchy", nodes, edges);
  }

  if (action === "get_page") {
    const spaceKey = (data["space_key"] as string | undefined) ?? "";
    const title = ((data["title"] as string | undefined) ?? "page").slice(0, 60);
    if (title.length === 0) return undefined;
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    if (spaceKey.length > 0) {
      nodes.push({ id: "space", label: spaceKey, shape: "rounded" });
      nodes.push({ id: "page", label: title });
      edges.push({ from: "space", to: "page" });
    } else {
      nodes.push({ id: "page", label: title });
    }
    return formatGraph("TB", "Page Hierarchy", nodes, edges);
  }

  return undefined;
}

function mermaidForNotion(result: Record<string, unknown>): MermaidBlock | undefined {
  if (result["status"] !== "success") return undefined;
  const action = result["action"];
  const data = result["data"] as Record<string, unknown> | undefined;
  if (data === undefined) return undefined;

  if (action === "search") {
    const results = (data["results"] as Array<Record<string, unknown>> | undefined) ?? [];
    if (results.length === 0) return undefined;
    const capped = results.slice(0, 30);
    const nodes: GraphNode[] = [
      { id: "root", label: "Search Results", shape: "rounded" },
    ];
    const edges: GraphEdge[] = [];
    for (const [i, r] of capped.entries()) {
      const id = ((r["id"] as string | undefined) ?? `r${i}`).slice(0, 8);
      const objType = ((r["object_type"] as string | undefined) ?? "page").slice(0, 20);
      nodes.push({ id: `r${i}`, label: `${objType} ${id}` });
      edges.push({ from: "root", to: `r${i}` });
    }
    return formatGraph("TB", "Notion Search Hierarchy", nodes, edges);
  }

  if (action === "query_database") {
    const databaseId = (data["database_id"] as string | undefined) ?? "database";
    const results = (data["results"] as Array<Record<string, unknown>> | undefined) ?? [];
    if (results.length === 0) return undefined;
    const capped = results.slice(0, 30);
    const dbLabel = databaseId.length > 8 ? databaseId.slice(0, 8) + "…" : databaseId;
    const nodes: GraphNode[] = [
      { id: "db", label: `DB ${dbLabel}`, shape: "rounded" },
    ];
    const edges: GraphEdge[] = [];
    for (const [i, r] of capped.entries()) {
      const title = ((r["title"] as string | undefined) ?? `row ${i}`).slice(0, 60);
      nodes.push({ id: `p${i}`, label: title });
      edges.push({ from: "db", to: `p${i}` });
    }
    return formatGraph("TB", "Notion Page Tree", nodes, edges);
  }

  return undefined;
}

function parsePackageJsonDeps(content: string): string[] {
  try {
    const parsed = JSON.parse(content) as {
      dependencies?: Record<string, unknown>;
      devDependencies?: Record<string, unknown>;
    };
    const deps = [
      ...Object.keys(parsed.dependencies ?? {}),
      ...Object.keys(parsed.devDependencies ?? {}),
    ];
    return [...new Set(deps)];
  } catch {
    return [];
  }
}

function parseRequirementsTxt(content: string): string[] {
  const deps: string[] = [];
  const seen = new Set<string>();
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const m = line.match(/^([A-Za-z0-9_.\-]+)/);
    if (!m) continue;
    const name = m[1]!;
    if (seen.has(name)) continue;
    seen.add(name);
    deps.push(name);
  }
  return deps;
}

function mermaidForGithub(result: Record<string, unknown>): MermaidBlock | undefined {
  if (result["status"] !== "success") return undefined;
  if (result["action"] !== "get_file") return undefined;
  const data = result["data"] as Record<string, unknown> | undefined;
  if (data === undefined) return undefined;

  const filePath = ((data["path"] as string) ?? "").toLowerCase();
  const content = (data["content"] as string) ?? "";
  if (content === "") return undefined;

  let deps: string[] = [];
  if (filePath.endsWith("package.json")) {
    deps = parsePackageJsonDeps(content);
  } else if (filePath.endsWith("requirements.txt")) {
    deps = parseRequirementsTxt(content);
  }

  if (deps.length === 0) return undefined;
  const capped = deps.slice(0, 40);
  const rootLabel = (data["path"] as string) || "repo";
  const nodes: GraphNode[] = [
    { id: "root", label: rootLabel, shape: "rounded" },
    ...capped.map((d, i) => ({ id: `dep_${i}`, label: d })),
  ];
  const edges: GraphEdge[] = capped.map((_, i) => ({
    from: "root",
    to: `dep_${i}`,
  }));
  return formatGraph("LR", "Dependency Graph", nodes, edges);
}

interface DbWrapperTable {
  name: string;
  columns: Array<{
    name: string;
    data_type?: string;
    is_primary_key?: boolean;
  }>;
}

function mermaidForDb(result: Record<string, unknown>): MermaidBlock | undefined {
  // db-agent uses `status: "ok"` instead of `success`, and emits the
  // schema action's `tables` array at top level rather than nested in `data`.
  if (result["status"] !== "ok") return undefined;
  const tables = result["tables"];
  if (!Array.isArray(tables) || tables.length === 0) return undefined;
  const wrapped = tables as DbWrapperTable[];
  const ermTables: ErTable[] = wrapped.map((t) => {
    const cols: ErColumn[] = t.columns.map((c) => {
      const col: ErColumn = {
        name: c.name,
        type: c.data_type || "string",
      };
      if (c.is_primary_key) col.key = "PK";
      return col;
    });
    return { name: t.name, columns: cols };
  });
  return formatErDiagram("Database Schema", ermTables, []);
}

// ── Dispatch table ────────────────────────────────────────────────────

type Transformer = (envelope: Record<string, unknown>) => MermaidBlock | undefined;

const TRANSFORMERS: Record<string, Transformer> = {
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
export function applyMermaid(result: DispatchResult): DispatchResult {
  if (result.error !== undefined) return result;
  const envelope = result.envelope;
  if (envelope === null || typeof envelope !== "object") return result;

  const transformer = TRANSFORMERS[result.connector];
  if (transformer === undefined) return result;

  const env = envelope as Record<string, unknown>;
  const mermaid = transformer(env);
  if (mermaid === undefined) return result;

  return {
    ...result,
    envelope: { ...env, mermaid },
  };
}

/** Connector short names this module knows how to augment. Used by tests
 *  and any caller that wants to filter to structural-action connectors. */
export const SUPPORTED_CONNECTORS: ReadonlySet<string> = new Set(
  Object.keys(TRANSFORMERS),
);
