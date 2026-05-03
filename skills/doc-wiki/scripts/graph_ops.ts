#!/usr/bin/env node
/**
 * Knowledge-graph edge operations for the documentation wiki.
 *
 * Manages typed, provenanced edges in an edges.jsonl file and provides
 * graph-analysis utilities (degrees, god nodes, path finding).
 *
 * Usage as a library:
 *     import { addEdge, shortestPath, godNodes } from "./graph_ops.js";
 *     addEdge("graph/edges.jsonl", "A.md", "B.md", "extends", "EXTRACTED");
 *     const path = shortestPath("graph/edges.jsonl", "A.md", "C.md");
 *
 * Usage as a script:
 *     node graph_ops.js add --edges graph/edges.jsonl --from A --to B --type extends --provenance EXTRACTED
 *     node graph_ops.js path --edges graph/edges.jsonl --from A --to D --max-hops 6
 *     node graph_ops.js degrees --edges graph/edges.jsonl
 *     node graph_ops.js god-nodes --edges graph/edges.jsonl --top 10
 *
 * This is a TypeScript port of graph_ops.py; behaviour and CLI output match
 * the Python reference byte-for-byte for the same inputs.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import Graph from "graphology";
import { bidirectional } from "graphology-shortest-path/unweighted.js";

// ── Constants ───────────────────────────────────────────────────────

export const VALID_EDGE_TYPES: ReadonlySet<string> = new Set([
  "supports",
  "contradicts",
  "extends",
  "supersedes",
]);

export const VALID_PROVENANCE: ReadonlySet<string> = new Set([
  "EXTRACTED",
  "INFERRED",
  "AMBIGUOUS",
]);

/** The on-disk shape of a single edge record. Kept loose to mirror Python's
 *  dict semantics: every caller may attach arbitrary extra keys. */
export type Edge = Record<string, unknown> & {
  from: string;
  to: string;
  type: string;
  provenance: string;
  evidence?: string;
  source_file?: string;
  date?: string;
};

// ── Edge CRUD ───────────────────────────────────────────────────────

/** Read every edge from the JSONL file (returns empty list if missing or
 *  empty, matching the Python helper). */
function readAllEdges(edgesPath: string): Edge[] {
  if (!fs.existsSync(edgesPath)) {
    return [];
  }
  const stat = fs.statSync(edgesPath);
  if (stat.size === 0) {
    return [];
  }
  const raw = fs.readFileSync(edgesPath, { encoding: "utf-8" });
  const edges: Edge[] = [];
  for (const rawLine of raw.split("\n")) {
    const line = rawLine.trim();
    if (line) {
      edges.push(JSON.parse(line) as Edge);
    }
  }
  return edges;
}

/** Overwrite the JSONL file with the given edges. Each line uses Python's
 *  `json.dumps(e)` default formatting so the file is byte-identical across
 *  the Python and TypeScript implementations. */
function writeAllEdges(edgesPath: string, edges: readonly Edge[]): void {
  const lines = edges.map((e) => JSON.stringify(e) + "\n");
  fs.writeFileSync(edgesPath, lines.join(""), { encoding: "utf-8" });
}

/**
 * Python's `date.today().isoformat()` in the system's local timezone.
 * Kept as an explicit helper so tests can mock it if needed and so behaviour
 * mirrors the Python reference (which also uses the local date).
 */
function todayIso(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Append a typed, provenanced edge to edges.jsonl.
 *
 * @throws {Error} If edge_type or provenance is invalid.
 * @returns The edge dict that was written.
 */
export function addEdge(
  edgesPath: string,
  fromPage: string,
  toPage: string,
  edgeType: string,
  provenance: string,
  evidence: string = "",
  sourceFile: string = "",
): Edge {
  if (!VALID_EDGE_TYPES.has(edgeType)) {
    const sorted = [...VALID_EDGE_TYPES].sort();
    throw new Error(
      `Invalid edge type '${edgeType}'. Must be one of: ${formatPyList(sorted)}`,
    );
  }
  if (!VALID_PROVENANCE.has(provenance)) {
    const sorted = [...VALID_PROVENANCE].sort();
    throw new Error(
      `Invalid provenance '${provenance}'. Must be one of: ${formatPyList(sorted)}`,
    );
  }

  const edge: Edge = {
    from: fromPage,
    to: toPage,
    type: edgeType,
    provenance,
    evidence,
    source_file: sourceFile,
    date: todayIso(),
  };

  fs.appendFileSync(edgesPath, JSON.stringify(edge) + "\n");
  return edge;
}

/**
 * Render a list of strings the same way Python's repr does for a list of
 * strings: single quotes, comma-space separator, wrapped in [].
 * Used only to format the error message so it reads naturally.
 */
function formatPyList(items: readonly string[]): string {
  return "[" + items.map((s) => `'${s}'`).join(", ") + "]";
}

/**
 * Remove the first edge matching from/to/type.
 *
 * @returns True if an edge was removed.
 */
export function removeEdge(
  edgesPath: string,
  fromPage: string,
  toPage: string,
  edgeType: string,
): boolean {
  const edges = readAllEdges(edgesPath);
  const next: Edge[] = [];
  let removed = false;
  for (const e of edges) {
    if (
      !removed &&
      e.from === fromPage &&
      e.to === toPage &&
      e.type === edgeType
    ) {
      removed = true;
      continue;
    }
    next.push(e);
  }
  if (removed) {
    writeAllEdges(edgesPath, next);
  }
  return removed;
}

/** Return all edges, optionally filtered by type. */
export function listEdges(edgesPath: string, edgeType?: string | null): Edge[] {
  const edges = readAllEdges(edgesPath);
  if (edgeType !== undefined && edgeType !== null) {
    return edges.filter((e) => e.type === edgeType);
  }
  return edges;
}

// ── Degree analysis ─────────────────────────────────────────────────

/**
 * Compute the degree (in-degree + out-degree) for every node. Node order
 * matches Python: first appearance across edges (either endpoint) wins.
 */
export function computeDegrees(edgesPath: string): Record<string, number> {
  const edges = readAllEdges(edgesPath);
  const degrees: Record<string, number> = {};
  for (const e of edges) {
    degrees[e.from] = (degrees[e.from] ?? 0) + 1;
    degrees[e.to] = (degrees[e.to] ?? 0) + 1;
  }
  return degrees;
}

/**
 * Return the top-N highest-degree nodes as `[node, degree]` tuples.
 *
 * Nodes whose names contain any of `excludeTypes` (case-insensitive) are
 * filtered out. Defaults: ["Index", "Summary"].
 */
export function godNodes(
  edgesPath: string,
  topN: number = 10,
  excludeTypes?: readonly string[] | null,
): Array<[string, number]> {
  const exclude = excludeTypes ?? ["Index", "Summary"];
  const excludeLower = exclude.map((t) => t.toLowerCase());

  const degrees = computeDegrees(edgesPath);

  const filtered: Array<[string, number]> = [];
  for (const node of Object.keys(degrees)) {
    const lower = node.toLowerCase();
    const excluded = excludeLower.some((ex) => lower.includes(ex));
    if (!excluded) {
      const deg = degrees[node];
      if (deg !== undefined) {
        filtered.push([node, deg]);
      }
    }
  }

  // Python's sorted(..., key=x[1], reverse=True) is stable; Array.sort in V8 is
  // also stable. Sort only by degree (descending); ties keep insertion order.
  filtered.sort((a, b) => b[1] - a[1]);
  return filtered.slice(0, topN);
}

/** Return pages from `allPages` whose degree is <= 1. */
export function isolatedNodes(
  edgesPath: string,
  allPages: readonly string[],
): string[] {
  const degrees = computeDegrees(edgesPath);
  return allPages.filter((p) => (degrees[p] ?? 0) <= 1);
}

/**
 * Return weakly-connected components of the edge graph. Edges are treated as
 * undirected for clustering. Each component is an array of node names.
 *
 * When `allPages` is supplied, any page that does not appear in the edge file
 * is emitted as its own singleton cluster (preserves `allPages` ordering).
 * Components without an `allPages` anchor are ordered by the first appearance
 * of any member node across the edge file.
 */
export function clusters(
  edgesPath: string,
  allPages?: readonly string[] | null,
): string[][] {
  const edges = readAllEdges(edgesPath);
  const parent = new Map<string, string>();
  const order: string[] = [];

  const ensure = (node: string): void => {
    if (!parent.has(node)) {
      parent.set(node, node);
      order.push(node);
    }
  };
  const find = (node: string): string => {
    let cur = node;
    while (parent.get(cur) !== cur) {
      const p = parent.get(cur) ?? cur;
      parent.set(cur, parent.get(p) ?? p);
      cur = parent.get(cur) ?? cur;
    }
    return cur;
  };
  const union = (a: string, b: string): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) {
      parent.set(rb, ra);
    }
  };

  for (const e of edges) {
    ensure(e.from);
    ensure(e.to);
    union(e.from, e.to);
  }
  if (allPages) {
    for (const p of allPages) {
      ensure(p);
    }
  }

  // Group by root, preserving first-appearance order both at the group level
  // and within each group.
  const groups = new Map<string, string[]>();
  for (const node of order) {
    const root = find(node);
    const list = groups.get(root);
    if (list === undefined) {
      groups.set(root, [node]);
    } else {
      list.push(node);
    }
  }
  return [...groups.values()];
}

// ── Path finding (graphology) ───────────────────────────────────────

interface BuiltGraph {
  graph: Graph;
  edgeMap: Map<string, Edge>;
}

/** Build a directed graph from edges.jsonl, returning the graph plus a
 *  lookup from "from\u0000to" -> edge dict so we can reconstruct rich path
 *  output after BFS.
 *
 *  TRIP WIRE: shortest-path determinism depends on graphology iterating
 *  `outboundNeighbors` in node-insertion order (matching NetworkX's
 *  dict-of-dicts adjacency). If a future graphology version changes that,
 *  tie-broken paths will diverge from Python. The `shortest_path_tie_break_*`
 *  Vitest tests will flag the regression; address it by adding an explicit
 *  alphabetical comparator before passing neighbors to the BFS/DFS.
 */
function buildGraph(edgesPath: string): BuiltGraph {
  const edges = readAllEdges(edgesPath);
  const graph = new Graph({ type: "directed", allowSelfLoops: true });
  const edgeMap = new Map<string, Edge>();
  for (const e of edges) {
    const src = e.from;
    const tgt = e.to;
    if (!graph.hasNode(src)) graph.addNode(src);
    if (!graph.hasNode(tgt)) graph.addNode(tgt);
    if (!graph.hasEdge(src, tgt)) {
      graph.addDirectedEdge(src, tgt);
    }
    edgeMap.set(edgeKey(src, tgt), e);
  }
  return { graph, edgeMap };
}

function edgeKey(fromNode: string, toNode: string): string {
  return `${fromNode}\u0000${toNode}`;
}

/** Convert a list of node names to a list of edge dicts, filling in minimal
 *  `{from, to}` stubs when the (src, tgt) pair isn't present in the map. */
function nodesToEdgeList(
  nodePath: readonly string[],
  edgeMap: Map<string, Edge>,
): Edge[] {
  const result: Edge[] = [];
  for (let i = 0; i < nodePath.length - 1; i++) {
    const a = nodePath[i];
    const b = nodePath[i + 1];
    if (a === undefined || b === undefined) continue;
    const fromNode = a;
    const toNode = b;
    const got = edgeMap.get(edgeKey(fromNode, toNode));
    if (got !== undefined) {
      result.push(got);
    } else {
      result.push({
        from: fromNode,
        to: toNode,
        type: "",
        provenance: "",
      });
    }
  }
  return result;
}

/** Run graphology's bidirectional unweighted shortest path and normalize
 *  "no path" to an empty array. */
function bidiPath(
  graph: Graph,
  source: string,
  target: string,
): string[] | null {
  if (!graph.hasNode(source) || !graph.hasNode(target)) {
    return null;
  }
  const result = bidirectional(graph, source, target);
  return result ?? null;
}

/**
 * Find the shortest directed path between two concepts.
 *
 * If `via` is specified, the path must pass through that concept.
 * If `maxHops` is exceeded or no path exists, returns [].
 */
export function shortestPath(
  edgesPath: string,
  fromConcept: string,
  toConcept: string,
  maxHops: number = 6,
  via?: string | null,
): Edge[] {
  const { graph, edgeMap } = buildGraph(edgesPath);

  if (!graph.hasNode(fromConcept) || !graph.hasNode(toConcept)) {
    return [];
  }

  if (via !== undefined && via !== null) {
    const pathA = bidiPath(graph, fromConcept, via);
    const pathB = bidiPath(graph, via, toConcept);
    if (pathA === null || pathB === null) {
      return [];
    }
    // Merge: pathA ends with via, pathB starts with via
    const fullPath = [...pathA, ...pathB.slice(1)];
    const numEdges = fullPath.length - 1;
    if (numEdges > maxHops) {
      return [];
    }
    return nodesToEdgeList(fullPath, edgeMap);
  }

  const nodePath = bidiPath(graph, fromConcept, toConcept);
  if (nodePath === null) {
    return [];
  }
  const numEdges = nodePath.length - 1;
  if (numEdges > maxHops) {
    return [];
  }
  return nodesToEdgeList(nodePath, edgeMap);
}

/**
 * Return up to `maxPaths` simple directed paths between two concepts.
 *
 * Matches NetworkX's all_simple_paths iteration order (depth-first, yielding
 * paths in the order neighbors were inserted into the graph).
 */
export function allPaths(
  edgesPath: string,
  fromConcept: string,
  toConcept: string,
  maxPaths: number = 5,
): Edge[][] {
  const { graph, edgeMap } = buildGraph(edgesPath);

  if (!graph.hasNode(fromConcept) || !graph.hasNode(toConcept)) {
    return [];
  }

  const result: Edge[][] = [];
  for (const nodePath of iterSimplePaths(graph, fromConcept, toConcept)) {
    result.push(nodesToEdgeList(nodePath, edgeMap));
    if (result.length >= maxPaths) {
      break;
    }
  }
  return result;
}

/**
 * Generator (as an iterable) that yields every simple directed path from
 * source to target. Mirrors NetworkX's iterative-DFS traversal: neighbors are
 * visited in insertion order (graphology's `outboundNeighbors`), matching
 * Python's `iter(G[source])` for dict-of-dicts adjacency.
 *
 * "Simple" means no repeated nodes. The source itself counts as visited, so
 * paths of zero edges (source === target) are not yielded, matching NetworkX.
 */
function* iterSimplePaths(
  graph: Graph,
  source: string,
  target: string,
): Generator<string[]> {
  if (source === target) {
    return;
  }
  const visited: string[] = [source];
  const visitedSet = new Set<string>([source]);
  // Stack of iterator indices into the neighbors array for each depth level.
  const stack: Array<{ neighbors: string[]; idx: number }> = [
    { neighbors: graph.outboundNeighbors(source), idx: 0 },
  ];

  while (stack.length > 0) {
    const frame = stack[stack.length - 1];
    if (frame === undefined) break;
    if (frame.idx >= frame.neighbors.length) {
      stack.pop();
      const last = visited.pop();
      if (last !== undefined) {
        visitedSet.delete(last);
      }
      continue;
    }
    const child = frame.neighbors[frame.idx];
    frame.idx += 1;
    if (child === undefined) continue;
    if (visitedSet.has(child)) {
      continue;
    }
    if (child === target) {
      yield [...visited, child];
      continue;
    }
    visited.push(child);
    visitedSet.add(child);
    stack.push({ neighbors: graph.outboundNeighbors(child), idx: 0 });
  }
}

// ── CLI ─────────────────────────────────────────────────────────────

interface ParsedArgs {
  command?: string;
  edges?: string;
  fromPage?: string;
  toPage?: string;
  edgeType?: string;
  provenance?: string;
  evidence?: string;
  sourceFile?: string;
  fromConcept?: string;
  toConcept?: string;
  maxHops?: number;
  via?: string | null;
  top?: number;
  allPaths?: boolean;
  help?: boolean;
}

/**
 * Hand-rolled argparse-equivalent for graph_ops's subcommand CLI. argparse
 * allows `--flag value` or `--flag=value`; we replicate both. Subcommand
 * parsing is sensitive to which subcommand owns which flags — kept local so
 * the arg shape matches the Python argparse subparsers exactly.
 */
function parseArgs(argv: readonly string[]): ParsedArgs {
  const out: ParsedArgs = {};
  if (argv.length === 0) {
    return out;
  }

  let i = 0;
  // Top-level -h/--help check before subcommand selection.
  const first = argv[0];
  if (first === "-h" || first === "--help") {
    out.help = true;
    return out;
  }
  if (first !== undefined && !first.startsWith("-")) {
    out.command = first;
    i = 1;
  }

  while (i < argv.length) {
    const a = argv[i];
    if (a === undefined) {
      i++;
      continue;
    }
    if (a === "-h" || a === "--help") {
      out.help = true;
      i++;
      continue;
    }
    if (a === "--all-paths") {
      out.allPaths = true;
      i++;
      continue;
    }
    let name: string;
    let value: string | undefined;
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq >= 0) {
        name = a.slice(2, eq);
        value = a.slice(eq + 1);
        i++;
      } else {
        name = a.slice(2);
        value = argv[i + 1];
        i += 2;
      }
    } else {
      throw new Error(`unrecognized argument: ${a}`);
    }
    switch (name) {
      case "edges":
        out.edges = value ?? "";
        break;
      case "from":
        // --from is shared between `add` (from_page) and `path` (from_concept).
        // The subcommand disambiguates when we read the value.
        if (out.command === "path") {
          out.fromConcept = value ?? "";
        } else {
          out.fromPage = value ?? "";
        }
        break;
      case "to":
        if (out.command === "path") {
          out.toConcept = value ?? "";
        } else {
          out.toPage = value ?? "";
        }
        break;
      case "type":
        out.edgeType = value ?? "";
        break;
      case "provenance":
        out.provenance = value ?? "";
        break;
      case "evidence":
        out.evidence = value ?? "";
        break;
      case "source-file":
        out.sourceFile = value ?? "";
        break;
      case "max-hops":
        out.maxHops = Number(value ?? "6");
        break;
      case "via":
        out.via = value ?? "";
        break;
      case "top":
        out.top = Number(value ?? "10");
        break;
      default:
        throw new Error(`unrecognized argument: --${name}`);
    }
  }
  return out;
}

const HELP_TEXT = `usage: graph_ops.js [-h] {add,path,degrees,god-nodes} ...

Knowledge-graph edge operations.

positional arguments:
  {add,path,degrees,god-nodes}
    add                 Add an edge
    path                Find shortest path
    degrees             Compute node degrees
    god-nodes           Top-N highest-degree nodes

options:
  -h, --help            show this help message and exit
`;

export function main(argv: readonly string[] = process.argv.slice(2)): number {
  let args: ParsedArgs;
  try {
    args = parseArgs(argv);
  } catch (e) {
    process.stderr.write(`${(e as Error).message}\n`);
    return 2;
  }

  if (args.help) {
    process.stdout.write(HELP_TEXT);
    return 0;
  }

  try {
    if (args.command === "add") {
      const edge = addEdge(
        args.edges ?? "",
        args.fromPage ?? "",
        args.toPage ?? "",
        args.edgeType ?? "",
        args.provenance ?? "",
        args.evidence ?? "",
        args.sourceFile ?? "",
      );
      process.stdout.write(JSON.stringify(edge, null, 2) + "\n");
      return 0;
    }
    if (args.command === "path") {
      const from = args.fromConcept ?? "";
      const to = args.toConcept ?? "";
      if (args.allPaths) {
        const paths = allPaths(args.edges ?? "", from, to);
        if (paths.length === 0) {
          process.stdout.write(
            JSON.stringify(
              {
                paths: [],
                found: false,
                reason: `No paths from '${from}' to '${to}' — either the target is unknown, unreachable from the source, or no edges connect them in the directed graph.`,
              },
              null,
              2,
            ) + "\n",
          );
          return 0;
        }
        process.stdout.write(JSON.stringify(paths, null, 2) + "\n");
        return 0;
      }
      const maxHops = args.maxHops ?? 6;
      const via = args.via ?? null;
      const result = shortestPath(args.edges ?? "", from, to, maxHops, via);
      if (result.length === 0) {
        const viaClause = via ? ` via '${via}'` : "";
        process.stdout.write(
          JSON.stringify(
            {
              path: [],
              found: false,
              reason: `No path from '${from}' to '${to}'${viaClause} within ${maxHops} hops — either the target is unknown, unreachable from the source, or the shortest path exceeds --max-hops.`,
            },
            null,
            2,
          ) + "\n",
        );
        return 0;
      }
      process.stdout.write(JSON.stringify(result, null, 2) + "\n");
      return 0;
    }
    if (args.command === "degrees") {
      const result = computeDegrees(args.edges ?? "");
      process.stdout.write(JSON.stringify(result, null, 2) + "\n");
      return 0;
    }
    if (args.command === "god-nodes") {
      const result = godNodes(args.edges ?? "", args.top ?? 10);
      process.stdout.write(JSON.stringify(result, null, 2) + "\n");
      return 0;
    }
    process.stdout.write(HELP_TEXT);
    return 0;
  } catch (e) {
    process.stderr.write(`${(e as Error).message}\n`);
    return 1;
  }
}

// CLI entry point: run main() when this file is executed directly.
// Matches the Python `if __name__ == "__main__":` idiom.
const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === thisFile) {
  process.exit(main());
}
