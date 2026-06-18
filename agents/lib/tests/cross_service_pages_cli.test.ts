import { describe, it, expect, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { makeTmpPath, cleanupTmpPath } from "./fixtures.js";
import {
  writeCrossServicePages,
  pruneCrossServicePages,
  CROSS_SERVICE_SLUGS,
  main as crossServicePagesMain,
} from "../cross_service_pages.js";

const ALL_SLUGS = [
  "service-map",
  "service-dependencies",
  "client-registry",
  "queue-registry",
  "database-traces",
  "shared-libraries",
] as const;

/**
 * Write a doc-wiki-GENERATED cross-service page (carries the ownership marker),
 * mimicking what a prior atlas run left on disk. Deletion paths must remove
 * these; user-authored pages (no marker) must be preserved.
 */
function writeGeneratedPage(wikiDir: string, slug: string): string {
  const p = path.join(wikiDir, `${slug}.md`);
  fs.writeFileSync(
    p,
    `---\ntitle: ${slug}\ncross_service_page: ${slug}\ngenerated_by: cross_service_pages\n---\n\n# ${slug}\n\nold generated content\n`,
  );
  return p;
}

/** Write a USER-AUTHORED page sharing a slug name (NO ownership marker). */
function writeUserPage(wikiDir: string, slug: string): string {
  const p = path.join(wikiDir, `${slug}.md`);
  fs.writeFileSync(p, `# ${slug}\n\nhand-written by a human, must be preserved\n`);
  return p;
}

const RUN_ID = "2026-06-07T10-00-00";

/** Full-data fixture: 2 services with calls edges, queue, DB entity, shared lib. */
function makeFullInventory(): any {
  return {
    atlas_run_id: RUN_ID,
    services: [
      {
        identity: { id: "svc-a", kind: "service" },
        rest_endpoints: [{ method: "GET", path: "/api/a/items" }],
        http_clients: [{ framework: "feign", method: "GET", target_ref: "${svc-b.url}", path: "/api/b/x", file: "svc-a/C.java", line: 3 }],
        queue_endpoints: [{ framework: "spring_amqp", role: "producer", queue_name: "events", message_type: "EventDto", file: "svc-a/P.java", line: 1 }],
        orm_entities: [{ profile: "jpa", class_name: "Order", table_name: "orders", schema_name: "app", source_file: "svc-a/Order.java", columns: [{ name: "id", source_field: "id" }], relationships: [] }],
        external_sources: [],
        library_deps: ["common-lib"],
      },
      {
        identity: { id: "svc-b", kind: "service" },
        rest_endpoints: [{ method: "GET", path: "/api/b/x" }],
        http_clients: [],
        queue_endpoints: [{ framework: "spring_amqp", role: "consumer", queue_name: "events", message_type: "EventDto", file: "svc-b/C.java", line: 5 }],
        orm_entities: [],
        external_sources: [],
        library_deps: ["common-lib"],
      },
    ],
  };
}

function makeFullGraph(): any {
  return {
    services: [
      { id: "svc-a", kind: "service", language: "java", root: "svc-a" },
      { id: "svc-b", kind: "service", language: "java", root: "svc-b" },
      { id: "common-lib", kind: "library", language: "java", root: "shared/common-lib" },
    ],
    edges: [
      { from_service: "svc-a", to_service: "svc-b", kind: "calls", detail: "GET /api/b/x", confidence: "high", evidence_file: "svc-a/C.java", evidence_line: 3 },
      { from_service: "svc-a", to_service: "queue:events", kind: "produces", detail: "queue:events", confidence: "high", evidence_file: "svc-a/P.java", evidence_line: 1 },
      { from_service: "queue:events", to_service: "svc-b", kind: "consumes", detail: "queue:events", confidence: "high", evidence_file: "svc-b/C.java", evidence_line: 5 },
      { from_service: "svc-a", to_service: "common-lib", kind: "depends_on", detail: "lib:common-lib", confidence: "high", evidence_file: "svc-a/pom.xml", evidence_line: 0 },
      { from_service: "svc-b", to_service: "common-lib", kind: "depends_on", detail: "lib:common-lib", confidence: "high", evidence_file: "svc-b/pom.xml", evidence_line: 0 },
    ],
    generated_at: "",
  };
}

/** Empty-data fixture: no services at all. */
function makeEmptyInventory(): any {
  return { atlas_run_id: RUN_ID, services: [] };
}

function makeEmptyGraph(): any {
  return { services: [], edges: [], generated_at: "" };
}

describe("writeCrossServicePages", () => {
  it("writes all six cross-service pages when full data is present", () => {
    const wiki = makeTmpPath("xs-pages-full");
    const inventory = makeFullInventory();
    const graph = makeFullGraph();
    const written = writeCrossServicePages(wiki, inventory, graph);
    expect(written.length).toBe(6);
    for (const p of written) {
      expect(fs.existsSync(p)).toBe(true);
      const body = fs.readFileSync(p, "utf-8");
      expect(body.startsWith("---\n")).toBe(true);
      expect(body).toContain("atlas_facet: architecture");
      expect(body).toContain(`atlas_run_id: ${RUN_ID}`);
    }
    for (const slug of ALL_SLUGS) {
      const match = written.find((p) => p.endsWith(`${slug}.md`));
      expect(match, `missing page: ${slug}`).toBeTruthy();
      const body = fs.readFileSync(match!, "utf-8");
      expect(body).toContain(`cross_service_page: ${slug}`);
    }
    cleanupTmpPath(wiki);
  });

  it("writes zero pages when the graph and inventory are empty (no cross-service structure)", () => {
    const wiki = makeTmpPath("xs-pages-empty");
    const written = writeCrossServicePages(wiki, makeEmptyInventory(), makeEmptyGraph());
    expect(written.length).toBe(0);
    // No stale .md files written
    for (const slug of ALL_SLUGS) {
      expect(fs.existsSync(path.join(wiki, "wiki", `${slug}.md`))).toBe(false);
    }
    cleanupTmpPath(wiki);
  });

  it("deletes a stale GENERATED page left by a prior run when its data disappears (refresh)", () => {
    const wiki = makeTmpPath("xs-pages-stale");
    const wikiDir = path.join(wiki, "wiki");
    fs.mkdirSync(wikiDir, { recursive: true });
    // Simulate a prior run that GENERATED queue-registry.md; the current graph has no queues.
    const stale = writeGeneratedPage(wikiDir, "queue-registry");
    const written = writeCrossServicePages(wiki, makeEmptyInventory(), makeEmptyGraph());
    expect(written.length).toBe(0);
    expect(fs.existsSync(stale)).toBe(false); // stale generated page removed
    cleanupTmpPath(wiki);
  });

  it("prunes ALL SIX stale GENERATED slugs on the empty/no-content path (not just queue-registry)", () => {
    const wiki = makeTmpPath("xs-pages-stale-all");
    const wikiDir = path.join(wiki, "wiki");
    fs.mkdirSync(wikiDir, { recursive: true });
    // A prior run generated every cross-service page; the repo is now a monolith.
    for (const slug of ALL_SLUGS) writeGeneratedPage(wikiDir, slug);
    const written = writeCrossServicePages(wiki, makeEmptyInventory(), makeEmptyGraph());
    expect(written.length).toBe(0);
    for (const slug of ALL_SLUGS) {
      expect(fs.existsSync(path.join(wikiDir, `${slug}.md`)), `not pruned: ${slug}`).toBe(false);
    }
    cleanupTmpPath(wiki);
  });

  it("the no-content write path PRESERVES a user-authored file colliding on a slug name", () => {
    const wiki = makeTmpPath("xs-pages-usercollide");
    const wikiDir = path.join(wiki, "wiki");
    fs.mkdirSync(wikiDir, { recursive: true });
    // User hand-authored service-map.md (no ownership marker) — must survive a
    // no-content run (e.g. repo became a monolith).
    const userPage = writeUserPage(wikiDir, "service-map");
    const before = fs.readFileSync(userPage, "utf-8");
    const written = writeCrossServicePages(wiki, makeEmptyInventory(), makeEmptyGraph());
    expect(written.length).toBe(0);
    expect(fs.existsSync(userPage)).toBe(true); // preserved
    expect(fs.readFileSync(userPage, "utf-8")).toBe(before); // untouched
    cleanupTmpPath(wiki);
  });

  it("writes only the database-traces page when only DB entities are present", () => {
    const wiki = makeTmpPath("xs-pages-dbonly");
    const inventory = {
      atlas_run_id: RUN_ID,
      services: [
        {
          identity: { id: "svc-a", kind: "service" },
          rest_endpoints: [],
          http_clients: [],
          queue_endpoints: [],
          orm_entities: [{ profile: "jpa", class_name: "Order", table_name: "orders", schema_name: "app", source_file: "svc-a/Order.java", columns: [{ name: "id", source_field: "id" }], relationships: [] }],
          external_sources: [],
          library_deps: [],
        },
      ],
    } as any;
    const graph = {
      services: [{ id: "svc-a", kind: "service", language: "java", root: "svc-a" }],
      edges: [],
      generated_at: "",
    } as any;
    const written = writeCrossServicePages(wiki, inventory, graph);
    expect(written.length).toBe(1);
    const slugs = written.map((p) => path.basename(p, ".md"));
    expect(slugs).toContain("database-traces");
    // Pages without data must NOT be written
    for (const slug of ["service-map", "service-dependencies", "client-registry", "queue-registry", "shared-libraries"] as const) {
      expect(written.find((p) => p.endsWith(`${slug}.md`)), `unexpected page: ${slug}`).toBeUndefined();
      expect(fs.existsSync(path.join(wiki, "wiki", `${slug}.md`))).toBe(false);
    }
    cleanupTmpPath(wiki);
  });

  it("writes only queue-registry when only queue edges are present", () => {
    const wiki = makeTmpPath("xs-pages-queueonly");
    const inventory = {
      atlas_run_id: RUN_ID,
      services: [
        {
          identity: { id: "svc-a", kind: "service" },
          rest_endpoints: [],
          http_clients: [],
          queue_endpoints: [{ framework: "spring_amqp", role: "producer", queue_name: "events", message_type: "Msg", file: "svc-a/P.java", line: 1 }],
          orm_entities: [],
          external_sources: [],
          library_deps: [],
        },
      ],
    } as any;
    const graph = {
      services: [{ id: "svc-a", kind: "service", language: "java", root: "svc-a" }],
      edges: [
        { from_service: "svc-a", to_service: "queue:events", kind: "produces", detail: "queue:events", confidence: "high", evidence_file: "svc-a/P.java", evidence_line: 1 },
      ],
      generated_at: "",
    } as any;
    const written = writeCrossServicePages(wiki, inventory, graph);
    expect(written.length).toBe(1);
    expect(written[0]).toMatch(/queue-registry\.md$/);
    cleanupTmpPath(wiki);
  });

  it("writes service-map and service-dependencies when ≥2 services have calls edges, but not client/queue/db/lib pages when those are absent", () => {
    const wiki = makeTmpPath("xs-pages-callsonly");
    const inventory = {
      atlas_run_id: RUN_ID,
      services: [
        { identity: { id: "svc-a", kind: "service" }, rest_endpoints: [], http_clients: [], queue_endpoints: [], orm_entities: [], external_sources: [], library_deps: [] },
        { identity: { id: "svc-b", kind: "service" }, rest_endpoints: [], http_clients: [], queue_endpoints: [], orm_entities: [], external_sources: [], library_deps: [] },
      ],
    } as any;
    const graph = {
      services: [
        { id: "svc-a", kind: "service", language: "java", root: "svc-a" },
        { id: "svc-b", kind: "service", language: "java", root: "svc-b" },
      ],
      edges: [
        { from_service: "svc-a", to_service: "svc-b", kind: "calls", detail: "GET /api/b/x", confidence: "high", evidence_file: "svc-a/C.java", evidence_line: 1 },
      ],
      generated_at: "",
    } as any;
    const written = writeCrossServicePages(wiki, inventory, graph);
    const slugs = written.map((p) => path.basename(p, ".md"));
    expect(slugs).toContain("service-map");
    expect(slugs).toContain("service-dependencies");
    // The calls edge (svc-a → svc-b, both real) satisfies hasClientData too, so the
    // three call-graph pages are co-emitted. queue/db/shared have no data → skipped.
    expect(slugs).toContain("client-registry");
    expect(written.find((p) => p.endsWith("queue-registry.md"))).toBeUndefined();
    expect(written.find((p) => p.endsWith("database-traces.md"))).toBeUndefined();
    expect(written.find((p) => p.endsWith("shared-libraries.md"))).toBeUndefined();
    cleanupTmpPath(wiki);
  });

  it("writes service-map + service-dependencies from service count alone (≥2 services, no edges), without a client-registry link", () => {
    const wiki = makeTmpPath("xs-pages-svconly");
    const inventory = {
      atlas_run_id: RUN_ID,
      services: [
        { identity: { id: "svc-a", kind: "service" }, rest_endpoints: [{ method: "GET", path: "/api/a/x" }], http_clients: [], queue_endpoints: [], orm_entities: [], external_sources: [], library_deps: [] },
        { identity: { id: "svc-b", kind: "service" }, rest_endpoints: [{ method: "GET", path: "/api/b/y" }], http_clients: [], queue_endpoints: [], orm_entities: [], external_sources: [], library_deps: [] },
      ],
    } as any;
    const graph = {
      services: [
        { id: "svc-a", kind: "service", language: "java", root: "svc-a" },
        { id: "svc-b", kind: "service", language: "java", root: "svc-b" },
      ],
      edges: [], // no calls/queue/db/lib edges yet
      generated_at: "",
    } as any;
    const written = writeCrossServicePages(wiki, inventory, graph);
    const slugs = written.map((p) => path.basename(p, ".md"));
    // The real service list is genuine information → both topology pages emitted.
    expect(slugs).toContain("service-map");
    expect(slugs).toContain("service-dependencies");
    // Nothing else has data → those pages are skipped.
    for (const slug of ["client-registry", "queue-registry", "database-traces", "shared-libraries"] as const) {
      expect(written.find((p) => p.endsWith(`${slug}.md`)), `unexpected page: ${slug}`).toBeUndefined();
      expect(fs.existsSync(path.join(wiki, "wiki", `${slug}.md`))).toBe(false);
    }
    // Dangling-link safety: with no calls edges there is no transitive note,
    // so the service-map body must NOT link to the (skipped) client-registry page.
    const serviceMapBody = fs.readFileSync(path.join(wiki, "wiki", "service-map.md"), "utf-8");
    expect(serviceMapBody).not.toContain("client-registry.md");
    cleanupTmpPath(wiki);
  });

  it("does NOT emit topology pages for one service + a library that calls it (lib->service edge)", () => {
    const wiki = makeTmpPath("xs-pages-lib-edge");
    const inventory = {
      atlas_run_id: RUN_ID,
      services: [
        { identity: { id: "svc-a", kind: "service" }, rest_endpoints: [], http_clients: [], queue_endpoints: [], orm_entities: [], external_sources: [], library_deps: [] },
      ],
    } as any;
    const graph = {
      services: [
        { id: "svc-a", kind: "service", language: "java", root: "svc-a" },
        { id: "common-lib", kind: "library", language: "java", root: "shared/common-lib" },
      ],
      // A library with an HTTP client can produce a calls edge from the lib to the service.
      edges: [
        { from_service: "common-lib", to_service: "svc-a", kind: "calls", detail: "GET /api/a/x", confidence: "high", evidence_file: "common-lib/C.java", evidence_line: 1 },
      ],
      generated_at: "",
    } as any;
    const written = writeCrossServicePages(wiki, inventory, graph);
    const slugs = written.map((p) => path.basename(p, ".md"));
    // The lib->service calls edge is NOT real service topology, so the topology
    // pages must be skipped (the codex finding). client-registry is allowed —
    // a library HTTP-client callsite is a genuine, non-fabricated callsite.
    expect(slugs).not.toContain("service-map");
    expect(slugs).not.toContain("service-dependencies");
    expect(fs.existsSync(path.join(wiki, "wiki", "service-map.md"))).toBe(false);
    expect(fs.existsSync(path.join(wiki, "wiki", "service-dependencies.md"))).toBe(false);
    cleanupTmpPath(wiki);
  });

  it("does NOT emit topology pages for one service plus a library (a lib is not a service)", () => {
    const wiki = makeTmpPath("xs-pages-svc-plus-lib");
    const inventory = {
      atlas_run_id: RUN_ID,
      services: [
        { identity: { id: "svc-a", kind: "service" }, rest_endpoints: [], http_clients: [], queue_endpoints: [], orm_entities: [], external_sources: [], library_deps: [] },
      ],
    } as any;
    const graph = {
      services: [
        { id: "svc-a", kind: "service", language: "java", root: "svc-a" },
        { id: "common-lib", kind: "library", language: "java", root: "shared/common-lib" },
      ],
      edges: [], // no calls edges
      generated_at: "",
    } as any;
    const written = writeCrossServicePages(wiki, inventory, graph);
    // Only one real service (the library doesn't count) and no calls → no scaffolding.
    expect(written.length).toBe(0);
    for (const slug of ALL_SLUGS) {
      expect(fs.existsSync(path.join(wiki, "wiki", `${slug}.md`))).toBe(false);
    }
    cleanupTmpPath(wiki);
  });
});

// ── prune: remove all cross-service pages when cross-service resolves OFF ──

describe("pruneCrossServicePages", () => {
  it("removes all six GENERATED cross-service pages when present (opt-out / drop below 2 services)", () => {
    const wiki = makeTmpPath("xs-prune-all");
    const wikiDir = path.join(wiki, "wiki");
    fs.mkdirSync(wikiDir, { recursive: true });
    for (const slug of ALL_SLUGS) writeGeneratedPage(wikiDir, slug);
    const removed = pruneCrossServicePages(wiki);
    expect(removed.length).toBe(6);
    for (const slug of ALL_SLUGS) {
      expect(fs.existsSync(path.join(wikiDir, `${slug}.md`)), `not pruned: ${slug}`).toBe(false);
    }
    cleanupTmpPath(wiki);
  });

  it("is idempotent — no error and removes nothing when no pages exist", () => {
    const wiki = makeTmpPath("xs-prune-none");
    fs.mkdirSync(path.join(wiki, "wiki"), { recursive: true });
    const removed = pruneCrossServicePages(wiki);
    expect(removed).toEqual([]);
    cleanupTmpPath(wiki);
  });

  // codex P2 (data-loss): a user-authored page sharing a slug name must NEVER
  // be deleted by prune — only doc-wiki-generated pages (with the marker) are.
  it("does NOT delete a user-authored service-map.md that lacks the ownership marker", () => {
    const wiki = makeTmpPath("xs-prune-userauthored");
    const wikiDir = path.join(wiki, "wiki");
    fs.mkdirSync(wikiDir, { recursive: true });
    const userPage = writeUserPage(wikiDir, "service-map");
    const before = fs.readFileSync(userPage, "utf-8");
    const removed = pruneCrossServicePages(wiki);
    expect(removed).toEqual([]); // nothing deleted
    expect(fs.existsSync(userPage)).toBe(true);
    expect(fs.readFileSync(userPage, "utf-8")).toBe(before); // untouched
    cleanupTmpPath(wiki);
  });

  it("with a mix, deletes ONLY the marked (generated) pages and preserves user-authored ones", () => {
    const wiki = makeTmpPath("xs-prune-mixed");
    const wikiDir = path.join(wiki, "wiki");
    fs.mkdirSync(wikiDir, { recursive: true });
    // Generated: service-map, client-registry → deleted.
    writeGeneratedPage(wikiDir, "service-map");
    writeGeneratedPage(wikiDir, "client-registry");
    // User-authored colliding slugs: queue-registry, database-traces → preserved.
    const userQueue = writeUserPage(wikiDir, "queue-registry");
    const userDb = writeUserPage(wikiDir, "database-traces");
    const removed = pruneCrossServicePages(wiki);
    expect(removed.length).toBe(2);
    expect(removed.some((p) => p.endsWith("service-map.md"))).toBe(true);
    expect(removed.some((p) => p.endsWith("client-registry.md"))).toBe(true);
    expect(fs.existsSync(path.join(wikiDir, "service-map.md"))).toBe(false);
    expect(fs.existsSync(path.join(wikiDir, "client-registry.md"))).toBe(false);
    expect(fs.existsSync(userQueue)).toBe(true); // user page preserved
    expect(fs.existsSync(userDb)).toBe(true); // user page preserved
    cleanupTmpPath(wiki);
  });

  it("leaves non-cross-service pages (different slug) untouched", () => {
    const wiki = makeTmpPath("xs-prune-keep");
    const wikiDir = path.join(wiki, "wiki");
    fs.mkdirSync(wikiDir, { recursive: true });
    writeGeneratedPage(wikiDir, "service-map"); // generated → deleted
    const keep = path.join(wikiDir, "overview.md"); // unrelated slug → kept
    fs.writeFileSync(keep, "# Overview\n");
    const removed = pruneCrossServicePages(wiki);
    expect(removed.length).toBe(1);
    expect(fs.existsSync(path.join(wikiDir, "service-map.md"))).toBe(false);
    expect(fs.existsSync(keep)).toBe(true); // unrelated page preserved
    cleanupTmpPath(wiki);
  });

  it("CROSS_SERVICE_SLUGS exposes exactly the six known cross-service slugs", () => {
    expect([...CROSS_SERVICE_SLUGS].sort()).toEqual([...ALL_SLUGS].sort());
  });
});

describe("cross_service_pages.js prune CLI", () => {
  it("prune subcommand removes the six generated slugs and needs no run-id/inventory/graph", () => {
    const wiki = makeTmpPath("xs-prune-cli");
    const wikiDir = path.join(wiki, "wiki");
    fs.mkdirSync(wikiDir, { recursive: true });
    for (const slug of ALL_SLUGS) writeGeneratedPage(wikiDir, slug);
    const stdout: string[] = [];
    const outSpy = vi.spyOn(process.stdout, "write").mockImplementation((c) => { stdout.push(c.toString()); return true; });
    const errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      const exit = crossServicePagesMain(["prune", "--wiki-root", wiki]);
      expect(exit).toBe(0);
      const removed = JSON.parse(stdout.join("").trim()) as string[];
      expect(removed.length).toBe(6);
    } finally {
      outSpy.mockRestore();
      errSpy.mockRestore();
    }
    for (const slug of ALL_SLUGS) {
      expect(fs.existsSync(path.join(wikiDir, `${slug}.md`))).toBe(false);
    }
    cleanupTmpPath(wiki);
  });

  it("prune CLI is idempotent (exit 0, empty array) when no pages exist", () => {
    const wiki = makeTmpPath("xs-prune-cli-none");
    fs.mkdirSync(path.join(wiki, "wiki"), { recursive: true });
    const stdout: string[] = [];
    const outSpy = vi.spyOn(process.stdout, "write").mockImplementation((c) => { stdout.push(c.toString()); return true; });
    const errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      const exit = crossServicePagesMain(["prune", "--wiki-root", wiki]);
      expect(exit).toBe(0);
      expect(JSON.parse(stdout.join("").trim())).toEqual([]);
    } finally {
      outSpy.mockRestore();
      errSpy.mockRestore();
    }
    cleanupTmpPath(wiki);
  });

  it("prune CLI preserves a user-authored page sharing a slug name (exit 0, empty array)", () => {
    const wiki = makeTmpPath("xs-prune-cli-user");
    const wikiDir = path.join(wiki, "wiki");
    fs.mkdirSync(wikiDir, { recursive: true });
    const userPage = writeUserPage(wikiDir, "service-map");
    const stdout: string[] = [];
    const outSpy = vi.spyOn(process.stdout, "write").mockImplementation((c) => { stdout.push(c.toString()); return true; });
    const errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      const exit = crossServicePagesMain(["prune", "--wiki-root", wiki]);
      expect(exit).toBe(0);
      expect(JSON.parse(stdout.join("").trim())).toEqual([]);
    } finally {
      outSpy.mockRestore();
      errSpy.mockRestore();
    }
    expect(fs.existsSync(userPage)).toBe(true); // user page preserved
    cleanupTmpPath(wiki);
  });
});
