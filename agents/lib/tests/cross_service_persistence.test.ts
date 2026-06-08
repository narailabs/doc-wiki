import * as fs from "node:fs";
import { describe, it, expect } from "vitest";
import { makeTmpPath, cleanupTmpPath } from "./fixtures.js";
import { serviceGraphPath, persistServiceGraph, loadServiceGraph } from "../cross_service_edges.js";

describe("service-graph persistence", () => {
  it("persists and round-trips a service graph", () => {
    const wiki = makeTmpPath("sg");
    const runId = "2026-06-07T10-00-00";
    const graph = {
      services: [{ id: "a", kind: "service", language: "java", root: "a" }],
      edges: [{
        from_service: "a",
        to_service: "b",
        kind: "calls",
        detail: "GET /x",
        confidence: "high",
        evidence_file: "a/C.java",
        evidence_line: 1,
      }],
      generated_at: "2026-06-07T10:00:00Z",
    } as any;
    const p = persistServiceGraph(wiki, runId, graph);
    expect(p).toBe(serviceGraphPath(wiki, runId));
    expect(fs.existsSync(p)).toBe(true);
    const loaded = loadServiceGraph(wiki, runId)!;
    expect(loaded.edges.length).toBe(1);
    expect(loaded.edges[0].to_service).toBe("b");
    cleanupTmpPath(wiki);
  });

  it("loadServiceGraph returns null for a missing file", () => {
    const wiki = makeTmpPath("sg-missing");
    expect(loadServiceGraph(wiki, "2026-06-07T10-00-00")).toBeNull();
    cleanupTmpPath(wiki);
  });
});
