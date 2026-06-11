import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { makeTmpPath, cleanupTmpPath } from "./fixtures.js";
import { writeCrossServicePages } from "../cross_service_pages.js";

const ALL_SLUGS = [
  "service-map",
  "service-dependencies",
  "client-registry",
  "queue-registry",
  "database-traces",
  "shared-libraries",
] as const;

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

  it("deletes a stale page left by a prior run when its data disappears (refresh)", () => {
    const wiki = makeTmpPath("xs-pages-stale");
    const wikiDir = path.join(wiki, "wiki");
    fs.mkdirSync(wikiDir, { recursive: true });
    // Simulate a prior run that wrote queue-registry.md; the current graph has no queues.
    const stale = path.join(wikiDir, "queue-registry.md");
    fs.writeFileSync(stale, "# Message Queue Registry\n\nold stale content\n");
    const written = writeCrossServicePages(wiki, makeEmptyInventory(), makeEmptyGraph());
    expect(written.length).toBe(0);
    expect(fs.existsSync(stale)).toBe(false); // stale page removed
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
});
