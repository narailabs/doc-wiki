/**
 * mermaid_format.ts — shared Mermaid output-envelope helpers for agents.
 *
 * Per v2 design §6, every source / mapper agent that produces
 * diagram-worthy structured data returns a `mermaid` field in its JSON
 * output so the wiki compiler can splice the diagram directly into a
 * compiled page. This module owns:
 *
 *   - The `MermaidBlock` envelope type (`{ type, title, code }`).
 *   - Label escaping (Mermaid treats `"`, `[`, `]`, `|`, `{`, `}`, `(`, `)`
 *     specially inside node labels).
 *   - Node-id sanitization (Mermaid node ids must be alphanumeric /
 *     underscore; we normalize unsafe characters to underscores and
 *     collapse runs).
 *   - Builders for the two shapes source agents need today:
 *       * `formatGraph("TB"|"LR", nodes, edges)` — flowchart-style
 *         service topology, dependency graphs, infrastructure topology.
 *       * `formatErDiagram(tables)` — entity-relationship diagrams
 *         (wiki-db-agent's schema-introspection path).
 *
 * Agents that don't produce diagram-worthy data MUST omit the `mermaid`
 * field entirely — do not emit an empty string or null. Compilation
 * treats the absence as "no diagram" rather than "empty diagram".
 */

/** Output envelope written into the agent's JSON result. */
export interface MermaidBlock {
  /** Top-level Mermaid diagram keyword, e.g. `graph TB`, `erDiagram`. */
  type: string;
  /** Human-readable title for the diagram (shown in the compiled page). */
  title: string;
  /** Mermaid source code, including the `type` header line. */
  code: string;
}

/** One node in a `graph TB` / `graph LR` diagram. */
export interface GraphNode {
  id: string;
  label: string;
  /** Optional Mermaid shape — `["label"]` (default), `(("label"))`, etc.
   *  Pass the opening token; the helper pairs it with the closing one. */
  shape?: "default" | "rounded" | "circle" | "stadium" | "subroutine";
}

/** One directed edge between two nodes. */
export interface GraphEdge {
  from: string;
  to: string;
  /** Optional edge label — rendered as `-->|label|`. */
  label?: string;
}

/** One column in an ER diagram table. */
export interface ErColumn {
  name: string;
  type?: string;
  /** Optional tag(s): PK, FK, UK. */
  key?: "PK" | "FK" | "UK";
}

/** One table + columns in an ER diagram. */
export interface ErTable {
  name: string;
  columns: ErColumn[];
}

/** One ER relationship — uses Mermaid cardinality tokens. */
export interface ErRelationship {
  from: string;
  to: string;
  /** Mermaid cardinality, e.g. `||--o{`, `}o--o{`, `||--||`. */
  cardinality: string;
  label: string;
}

/**
 * Replace characters that Mermaid treats specially inside node labels
 * with HTML-escaped equivalents. Keeps the label readable while making
 * the output parse-safe in every Mermaid runtime.
 */
export function sanitizeLabel(label: string): string {
  return label
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/\|/g, "&#124;")
    .replace(/\[/g, "&#91;")
    .replace(/\]/g, "&#93;")
    .replace(/\{/g, "&#123;")
    .replace(/\}/g, "&#125;")
    .replace(/[\r\n]+/g, " ")
    .trim();
}

/**
 * Coerce an arbitrary string into a Mermaid-legal node id: alphanumeric
 * and underscore only, with leading digits prefixed by `_` to dodge
 * Mermaid's identifier rules. Empty or all-special input returns `"_"`.
 */
export function sanitizeNodeId(raw: string): string {
  const cleaned = raw.replace(/[^A-Za-z0-9_]/g, "_").replace(/_+/g, "_");
  if (cleaned === "" || cleaned === "_") return "_";
  return /^[0-9]/.test(cleaned) ? "_" + cleaned : cleaned;
}

function shapeOpen(s: GraphNode["shape"]): string {
  switch (s) {
    case "rounded":   return "(";
    case "circle":    return "((";
    case "stadium":   return "([";
    case "subroutine":return "[[";
    default:          return "[";
  }
}
function shapeClose(s: GraphNode["shape"]): string {
  switch (s) {
    case "rounded":   return ")";
    case "circle":    return "))";
    case "stadium":   return "])";
    case "subroutine":return "]]";
    default:          return "]";
  }
}

/**
 * Format a `graph TB` / `graph LR` flowchart-style diagram. Use for
 * service topologies (cloud infra, issue hierarchies, dependency
 * graphs). Returns a full `MermaidBlock` ready to inline into JSON
 * output.
 */
export function formatGraph(
  direction: "TB" | "LR" | "RL" | "BT",
  title: string,
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
): MermaidBlock {
  const lines: string[] = [`graph ${direction}`];
  const seen = new Set<string>();
  for (const n of nodes) {
    const id = sanitizeNodeId(n.id);
    if (seen.has(id)) continue;
    seen.add(id);
    const open = shapeOpen(n.shape);
    const close = shapeClose(n.shape);
    lines.push(`    ${id}${open}"${sanitizeLabel(n.label)}"${close}`);
  }
  for (const e of edges) {
    const from = sanitizeNodeId(e.from);
    const to = sanitizeNodeId(e.to);
    const edge =
      e.label !== undefined && e.label !== ""
        ? `    ${from} -->|${sanitizeLabel(e.label)}| ${to}`
        : `    ${from} --> ${to}`;
    lines.push(edge);
  }
  return {
    type: `graph ${direction}`,
    title,
    code: lines.join("\n"),
  };
}

function formatErColumn(col: ErColumn): string {
  const type = (col.type ?? "string").replace(/\s+/g, "_");
  const key = col.key ? ` ${col.key}` : "";
  return `        ${type} ${col.name}${key}`;
}

/**
 * Format an ER diagram (`erDiagram`). Use for DB schema introspection
 * (wiki-db-agent) and ORM mapping (wiki-orm-agent — currently renders
 * its own inline; the helper is available if a future refactor wants
 * to share the output shape).
 */
export function formatErDiagram(
  title: string,
  tables: readonly ErTable[],
  relationships: readonly ErRelationship[] = [],
): MermaidBlock {
  const lines: string[] = ["erDiagram"];
  for (const t of tables) {
    lines.push(`    ${t.name} {`);
    for (const col of t.columns) lines.push(formatErColumn(col));
    lines.push("    }");
  }
  for (const rel of relationships) {
    lines.push(
      `    ${rel.from} ${rel.cardinality} ${rel.to} : "${sanitizeLabel(rel.label)}"`,
    );
  }
  return { type: "erDiagram", title, code: lines.join("\n") };
}
