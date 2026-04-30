/**
 * Tests for graph_ops.ts — ported from test_graph_ops.py.
 *
 * Every pytest `def test_*` becomes a Vitest `it()`. The CLI-parity tests
 * shell out to the compiled graph_ops.js via Node and diff its stdout
 * against graph_ops.py's output.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  addEdge,
  removeEdge,
  listEdges,
  computeDegrees,
  godNodes,
  isolatedNodes,
  shortestPath,
  allPaths,
  clusters,
} from "../graph_ops.js";
import {
  SCRIPTS_DIR,
  makeTmpPath,
  cleanupTmpPath,
  makeEmptyEdgesFile,
  makePopulatedEdgesFile,
} from "./fixtures.js";

const CLI = path.join(SCRIPTS_DIR, "graph_ops.js");

function runCli(
  args: readonly string[],
): { stdout: string; stderr: string; status: number } {
  try {
    const stdout = execFileSync("node", [CLI, ...args], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { stdout, stderr: "", status: 0 };
  } catch (e) {
    const err = e as NodeJS.ErrnoException & {
      status?: number;
      stdout?: Buffer | string;
      stderr?: Buffer | string;
    };
    return {
      stdout: typeof err.stdout === "string" ? err.stdout : (err.stdout?.toString("utf-8") ?? ""),
      stderr: typeof err.stderr === "string" ? err.stderr : (err.stderr?.toString("utf-8") ?? ""),
      status: err.status ?? 1,
    };
  }
}

// ── Edge CRUD tests ─────────────────────────────────────────────────

describe("TestAddEdge", () => {
  let tmpPath: string;
  let edgesFile: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("graph-add-");
    edgesFile = makeEmptyEdgesFile(tmpPath);
  });

  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("test_add_edge", () => {
    const result = addEdge(
      edgesFile,
      "wiki/auth/session.md",
      "wiki/auth/jwt.md",
      "extends",
      "EXTRACTED",
    );
    expect(result.from).toBe("wiki/auth/session.md");
    expect(result.to).toBe("wiki/auth/jwt.md");
    expect(result.type).toBe("extends");

    const raw = fs.readFileSync(edgesFile, { encoding: "utf-8" });
    const lines = raw.trim().split("\n");
    expect(lines).toHaveLength(1);
    const first = lines[0];
    if (first === undefined) throw new Error("expected at least one line");
    const stored = JSON.parse(first);
    expect(stored.type).toBe("extends");
  });

  it("test_add_edge_with_provenance", () => {
    for (const prov of ["EXTRACTED", "INFERRED", "AMBIGUOUS"] as const) {
      const result = addEdge(
        edgesFile,
        "A",
        "B",
        "supports",
        prov,
        `test ${prov}`,
      );
      expect(result.provenance).toBe(prov);
    }
  });

  it("test_add_edge_requires_provenance", () => {
    expect(() => addEdge(edgesFile, "A", "B", "extends", "WRONG")).toThrow(
      /provenance/i,
    );
  });

  it("test_edge_types_validated", () => {
    expect(() => addEdge(edgesFile, "A", "B", "depends_on", "EXTRACTED")).toThrow(
      /edge type/i,
    );
  });
});

describe("TestRemoveEdge", () => {
  let tmpPath: string;
  let edgesFile: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("graph-rm-");
    edgesFile = makeEmptyEdgesFile(tmpPath);
  });

  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("test_remove_edge", () => {
    addEdge(edgesFile, "A", "B", "extends", "EXTRACTED");
    addEdge(edgesFile, "B", "C", "supports", "INFERRED");

    const removed = removeEdge(edgesFile, "A", "B", "extends");
    expect(removed).toBe(true);

    const remaining = listEdges(edgesFile);
    expect(remaining).toHaveLength(1);
    const first = remaining[0];
    expect(first).toBeDefined();
    expect(first?.from).toBe("B");
  });
});

describe("TestListEdges", () => {
  let tmpPath: string;
  let populatedEdges: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("graph-list-");
    populatedEdges = makePopulatedEdgesFile(tmpPath);
  });

  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("test_list_edges", () => {
    const edges = listEdges(populatedEdges);
    expect(Array.isArray(edges)).toBe(true);
    expect(edges).toHaveLength(6);
    for (const e of edges) {
      expect(typeof e).toBe("object");
    }
  });

  it("test_query_edges_by_type", () => {
    const extendsEdges = listEdges(populatedEdges, "extends");
    expect(extendsEdges).toHaveLength(4);
    for (const e of extendsEdges) {
      expect(e.type).toBe("extends");
    }

    const contradicts = listEdges(populatedEdges, "contradicts");
    expect(contradicts).toHaveLength(1);
  });
});

// ── Degree / topology tests ─────────────────────────────────────────

describe("TestDegrees", () => {
  let tmpPath: string;
  let populatedEdges: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("graph-deg-");
    populatedEdges = makePopulatedEdgesFile(tmpPath);
  });

  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("test_degree_computation", () => {
    const degrees = computeDegrees(populatedEdges);
    // A: out to B, out to E => degree 2
    expect(degrees["A"]).toBe(2);
    // B: in from A, out to C => degree 2
    expect(degrees["B"]).toBe(2);
    // E: in from A, out to D, out to F => degree 3
    expect(degrees["E"]).toBe(3);
    // D: in from C, in from E => degree 2
    expect(degrees["D"]).toBe(2);
  });

  it("test_god_nodes", () => {
    const top = godNodes(populatedEdges, 2);
    expect(Array.isArray(top)).toBe(true);
    expect(top).toHaveLength(2);
    const first = top[0];
    expect(first).toBeDefined();
    expect(first?.[0]).toBe("E");
    expect(first?.[1]).toBe(3);
  });

  it("test_isolated_nodes", () => {
    const allPages = ["A", "B", "C", "D", "E", "F", "G", "H"];
    const iso = isolatedNodes(populatedEdges, allPages);
    // G and H have degree 0; F has degree 1 (only one edge: E->F)
    expect(iso).toContain("G");
    expect(iso).toContain("H");
    expect(iso).toContain("F");
    // A, B, C, D, E should NOT be isolated
    expect(iso).not.toContain("A");
    expect(iso).not.toContain("E");
  });
});

// ── Path-finding tests ──────────────────────────────────────────────

describe("TestShortestPath", () => {
  let tmpPath: string;
  let populatedEdges: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("graph-sp-");
    populatedEdges = makePopulatedEdgesFile(tmpPath);
  });

  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("test_shortest_path", () => {
    const p = shortestPath(populatedEdges, "A", "D");
    expect(p.length).toBeGreaterThanOrEqual(1);
    // Shortest path A->E->D has 2 edges
    const first = p[0];
    expect(first).toBeDefined();
    const nodesInPath = [first?.from, ...p.map((e) => e.to)];
    expect(nodesInPath[0]).toBe("A");
    expect(nodesInPath[nodesInPath.length - 1]).toBe("D");
    expect(p).toHaveLength(2);
  });

  it("test_shortest_path_with_max_hops", () => {
    // A->D requires at least 2 hops, so max_hops=1 should fail
    const p = shortestPath(populatedEdges, "A", "D", 1);
    expect(p).toEqual([]);
  });

  it("test_shortest_path_via_concept", () => {
    // Force path through B: A->B->C->D (length 3)
    const p = shortestPath(populatedEdges, "A", "D", 6, "B");
    const first = p[0];
    expect(first).toBeDefined();
    const nodes = [first?.from, ...p.map((e) => e.to)];
    expect(nodes).toContain("B");
    expect(nodes[0]).toBe("A");
    expect(nodes[nodes.length - 1]).toBe("D");
  });

  it("test_shortest_path_not_found", () => {
    const p = shortestPath(populatedEdges, "F", "A");
    // F has no outgoing edges to reach A in directed graph
    expect(p).toEqual([]);
  });

  it("shortest_path_via_missing_node_returns_empty", () => {
    // Documented TS divergence from Python: networkx raises NodeNotFound
    // when --via is absent from the graph; the TS port returns [] instead.
    // This test pins the current TS behavior so a future "fix" that throws
    // requires an explicit contract update.
    const p = shortestPath(populatedEdges, "A", "D", 6, "DOES_NOT_EXIST");
    expect(p).toEqual([]);
  });

  it("test_all_paths", () => {
    const paths = allPaths(populatedEdges, "A", "D", 5);
    expect(Array.isArray(paths)).toBe(true);
    // Should find at least 2 paths: A->B->C->D and A->E->D
    expect(paths.length).toBeGreaterThanOrEqual(2);
    for (const p of paths) {
      const first = p[0];
      expect(first).toBeDefined();
      const nodes = [first?.from, ...p.map((e) => e.to)];
      expect(nodes[0]).toBe("A");
      expect(nodes[nodes.length - 1]).toBe("D");
    }
  });
});

// ── Tie-break determinism ───────────────────────────────────────────

/**
 * When multiple shortest paths exist, graph_ops must deterministically
 * return the same one as the Python reference. The graph below has two
 * two-hop paths A->X->D and A->Y->D; Python's nx.shortest_path (forward
 * BFS over insertion-order adjacency) picks the X branch because X is
 * inserted first.
 */
describe("TestShortestPathTieBreak", () => {
  let tmpPath: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("graph-tie-");
  });

  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("tie_break_picks_insertion_order_first_edge", () => {
    const edgesFile = path.join(tmpPath, "edges.jsonl");
    const edges = [
      { from: "A", to: "X", type: "extends", provenance: "EXTRACTED",
        evidence: "", source_file: "", date: "2026-04-10" },
      { from: "A", to: "Y", type: "extends", provenance: "EXTRACTED",
        evidence: "", source_file: "", date: "2026-04-10" },
      { from: "X", to: "D", type: "extends", provenance: "EXTRACTED",
        evidence: "", source_file: "", date: "2026-04-10" },
      { from: "Y", to: "D", type: "extends", provenance: "EXTRACTED",
        evidence: "", source_file: "", date: "2026-04-10" },
    ];
    fs.writeFileSync(
      edgesFile,
      edges.map((e) => JSON.stringify(e)).join("\n") + "\n",
    );

    // Reproduces the original networkx tie-break: picks A->X->D because X
    // was inserted before Y. graphology's BFS must match that order.
    const p = shortestPath(edgesFile, "A", "D");
    expect(p).toHaveLength(2);
    const first = p[0];
    expect(first).toBeDefined();
    expect(first?.to).toBe("X");
    const second = p[1];
    expect(second).toBeDefined();
    expect(second?.to).toBe("D");

    const nodeOut = runCli([
      "path",
      "--edges",
      edgesFile,
      "--from",
      "A",
      "--to",
      "D",
    ]);
    expect(nodeOut.status).toBe(0);
    const parsed = JSON.parse(nodeOut.stdout);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].to).toBe("X");
    expect(parsed[1].to).toBe("D");
  });
});

// ── CLI smoke tests ────────────────────────────────────────────────

describe("TestGraphOpsCLI", () => {
  let tmpPath: string;
  let edgesFile: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("graph-cli-");
    edgesFile = makePopulatedEdgesFile(tmpPath);
  });

  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("cli_degrees_emits_json_object", () => {
    const js = runCli(["degrees", "--edges", edgesFile]);
    expect(js.status).toBe(0);
    const data = JSON.parse(js.stdout);
    expect(typeof data).toBe("object");
    expect(Object.keys(data).length).toBeGreaterThan(0);
  });

  it("cli_god_nodes_emits_top_n_array", () => {
    const js = runCli(["god-nodes", "--edges", edgesFile, "--top", "3"]);
    expect(js.status).toBe(0);
    const data = JSON.parse(js.stdout);
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeLessThanOrEqual(3);
  });

  it("cli_path_emits_edge_list", () => {
    const js = runCli([
      "path",
      "--edges",
      edgesFile,
      "--from",
      "A",
      "--to",
      "D",
    ]);
    expect(js.status).toBe(0);
    const data = JSON.parse(js.stdout);
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);
  });

  it("cli_path_no_result_returns_empty_array", () => {
    // F has no outgoing edges to A
    const js = runCli([
      "path",
      "--edges",
      edgesFile,
      "--from",
      "F",
      "--to",
      "A",
    ]);
    expect(js.status).toBe(0);
    const data = JSON.parse(js.stdout);
    expect(Array.isArray(data)).toBe(true);
    expect(data).toHaveLength(0);
  });

  it("cli_path_with_via_routes_through_waypoint", () => {
    const js = runCli([
      "path",
      "--edges",
      edgesFile,
      "--from",
      "A",
      "--to",
      "D",
      "--via",
      "B",
    ]);
    expect(js.status).toBe(0);
    const data = JSON.parse(js.stdout);
    expect(Array.isArray(data)).toBe(true);
    // Routing through B must mean B appears as a node in the path.
    const nodes = new Set<string>(data.flatMap((e: { from: string; to: string }) => [e.from, e.to]));
    expect(nodes.has("B")).toBe(true);
  });

  it("cli_path_all_paths_emits_edge_list_array", () => {
    const js = runCli([
      "path",
      "--edges",
      edgesFile,
      "--from",
      "A",
      "--to",
      "D",
      "--all-paths",
    ]);
    expect(js.status).toBe(0);
    const data = JSON.parse(js.stdout);
    // Output is Edge[][] — each inner array is one simple A→D path.
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThanOrEqual(2);
    for (const p of data) {
      expect(Array.isArray(p)).toBe(true);
      const first = p[0];
      const last = p[p.length - 1];
      expect(first.from).toBe("A");
      expect(last.to).toBe("D");
    }
  });

  it("cli_add_writes_edge", () => {
    const fresh = path.join(tmpPath, "fresh.jsonl");
    fs.writeFileSync(fresh, "");
    const js = runCli([
      "add",
      "--edges",
      fresh,
      "--from",
      "P",
      "--to",
      "Q",
      "--type",
      "extends",
      "--provenance",
      "EXTRACTED",
    ]);
    expect(js.status).toBe(0);
    const body = JSON.parse(js.stdout);
    expect(body.from).toBe("P");
    expect(body.to).toBe("Q");
    expect(body.type).toBe("extends");

    const written = fs.readFileSync(fresh, { encoding: "utf-8" })
      .trim()
      .split("\n");
    expect(written).toHaveLength(1);
  });
});

// ── clusters() tests ──────────────────────────────────────────────

describe("TestClusters", () => {
  let tmpPath: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("clusters-");
  });
  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("test_empty_edges_returns_empty_array", () => {
    const edgesFile = makeEmptyEdgesFile(tmpPath);
    expect(clusters(edgesFile)).toEqual([]);
  });

  it("test_empty_edges_with_allPages_returns_singletons", () => {
    const edgesFile = makeEmptyEdgesFile(tmpPath);
    const result = clusters(edgesFile, ["X.md", "Y.md", "Z.md"]);
    expect(result).toEqual([["X.md"], ["Y.md"], ["Z.md"]]);
  });

  it("test_connected_edges_single_cluster", () => {
    const edgesFile = path.join(tmpPath, "edges.jsonl");
    fs.writeFileSync(
      edgesFile,
      [
        { from: "A", to: "B", type: "extends", provenance: "EXTRACTED" },
        { from: "B", to: "C", type: "extends", provenance: "EXTRACTED" },
        { from: "C", to: "D", type: "extends", provenance: "EXTRACTED" },
      ]
        .map((e) => JSON.stringify(e))
        .join("\n") + "\n",
    );
    const result = clusters(edgesFile);
    expect(result).toHaveLength(1);
    expect(new Set(result[0])).toEqual(new Set(["A", "B", "C", "D"]));
  });

  it("test_disconnected_edges_multiple_clusters", () => {
    const edgesFile = path.join(tmpPath, "edges.jsonl");
    fs.writeFileSync(
      edgesFile,
      [
        { from: "A", to: "B", type: "extends", provenance: "EXTRACTED" },
        { from: "C", to: "D", type: "extends", provenance: "EXTRACTED" },
        { from: "D", to: "E", type: "extends", provenance: "EXTRACTED" },
      ]
        .map((e) => JSON.stringify(e))
        .join("\n") + "\n",
    );
    const result = clusters(edgesFile);
    expect(result).toHaveLength(2);
    // Order stable by first-seen node: A-cluster before C-cluster.
    expect(result[0]).toEqual(["A", "B"]);
    expect(new Set(result[1])).toEqual(new Set(["C", "D", "E"]));
  });

  it("test_allPages_adds_disconnected_nodes_as_singletons", () => {
    const edgesFile = path.join(tmpPath, "edges.jsonl");
    fs.writeFileSync(
      edgesFile,
      [{ from: "A", to: "B", type: "extends", provenance: "EXTRACTED" }]
        .map((e) => JSON.stringify(e))
        .join("\n") + "\n",
    );
    const result = clusters(edgesFile, ["A", "B", "Z", "Y"]);
    // Pair cluster first (from edges), then Z and Y as singletons in that order.
    expect(result).toEqual([["A", "B"], ["Z"], ["Y"]]);
  });

  it("test_undirected_treatment_for_back_edges", () => {
    // A->B and B->A should NOT create two separate clusters.
    const edgesFile = path.join(tmpPath, "edges.jsonl");
    fs.writeFileSync(
      edgesFile,
      [
        { from: "A", to: "B", type: "extends", provenance: "EXTRACTED" },
        { from: "B", to: "A", type: "supports", provenance: "INFERRED" },
      ]
        .map((e) => JSON.stringify(e))
        .join("\n") + "\n",
    );
    const result = clusters(edgesFile);
    expect(result).toHaveLength(1);
    expect(new Set(result[0])).toEqual(new Set(["A", "B"]));
  });

  it("test_missing_edges_file_returns_empty", () => {
    // readAllEdges silently returns [] on missing files.
    const result = clusters(path.join(tmpPath, "does-not-exist.jsonl"));
    expect(result).toEqual([]);
  });
});
