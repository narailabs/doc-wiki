import { describe, it, expect } from "vitest";
import { renderServiceMap, renderServiceDependencies, renderClientRegistry, renderQueueRegistry, renderDbTraces, renderSharedLibraryMatrix, countRealServices, hasServiceTopology } from "../cross_service_pages.js";
import type { ServiceIdentity } from "../service_discovery.js";

const graph = {
  services: [
    { id: "svc-a", kind: "service", language: "java", root: "svc-a" },
    { id: "payments-module", kind: "service", language: "java", root: "payments-module" },
    { id: "admin-ui", kind: "frontend", language: "typescript", root: "admin-ui" },
  ],
  edges: [
    { from_service: "svc-a", to_service: "payments-module", kind: "calls", detail: "GET /api/payments/invoices/{}", confidence: "high", evidence_file: "svc-a/C.java", evidence_line: 3 },
    { from_service: "admin-ui", to_service: "payments-module", kind: "calls", detail: "GET /api/payments/invoices/{}", confidence: "high", evidence_file: "admin-ui/api.ts", evidence_line: 2 },
    { from_service: "svc-a", to_service: "ext:db", kind: "external_source", detail: "database", confidence: "high", evidence_file: "x", evidence_line: 0 },
  ],
  generated_at: "",
} as any;
const inv = { services: [
  { identity: { id: "payments-module" }, rest_endpoints: [{ method: "GET", path: "/api/payments/invoices/{id}" }] },
] } as any;

const depGraph = {
  services: [
    { id: "config-service", kind: "service", language: "java", root: "config-service" },
    { id: "svc-a", kind: "service", language: "java", root: "svc-a" },
    { id: "svc-b", kind: "service", language: "java", root: "svc-b" },
  ],
  edges: [
    { from_service: "svc-a", to_service: "config-service", kind: "calls", detail: "GET /api/config/x", confidence: "high", evidence_file: "a", evidence_line: 1 },
    { from_service: "svc-b", to_service: "config-service", kind: "calls", detail: "GET /api/config/y", confidence: "high", evidence_file: "b", evidence_line: 1 },
    { from_service: "svc-a", to_service: "ext:db", kind: "external_source", detail: "database (configured): jdbc:postgresql://pg/x", confidence: "high", evidence_file: "a/app.yml", evidence_line: 2 },
  ],
  generated_at: "",
} as any;
const depInv = { services: [
  { identity: { id: "svc-a" }, external_sources: [{ kind: "database", detail: "jdbc:postgresql://pg/x", connector_id: "db", configured: true, file: "a/app.yml", line: 2 }] },
  { identity: { id: "svc-b" }, external_sources: [] },
  { identity: { id: "config-service" }, external_sources: [] },
] } as any;

describe("renderServiceDependencies", () => {
  it("ranks most-depended services by inbound calls", () => {
    const md = renderServiceDependencies(depGraph, depInv);
    expect(md).toContain("Most Depended");
    expect(md).toMatch(/config-service.*2/);   // config-service has 2 inbound
  });
  it("reports no circular dependencies when acyclic", () => {
    const md = renderServiceDependencies(depGraph, depInv);
    expect(md).toMatch(/Circular Dependencies[\s\S]*None identified/);
  });
  it("renders the External Dependencies & Configured Connectors section with a configured check", () => {
    const md = renderServiceDependencies(depGraph, depInv);
    expect(md).toContain("External Dependencies & Configured Connectors");
    expect(md).toMatch(/svc-a.*db.*(✓|yes|configured)/i);   // svc-a's db, configured
    expect(md.toLowerCase()).toContain("integrations.md");   // cross-link, not a re-derivation
  });
});

const crGraph = {
  services: [
    { id: "svc-a", kind: "service", language: "java", root: "svc-a" },
    { id: "payments-module", kind: "service", language: "java", root: "payments-module" },
  ],
  edges: [
    { from_service: "svc-a", to_service: "payments-module", kind: "calls", detail: "GET /api/payments/invoices/{}", confidence: "high", evidence_file: "svc-a/C.java", evidence_line: 3 },
    { from_service: "svc-a", to_service: "queue:billing-events", kind: "produces", detail: "queue:billing-events", confidence: "high", evidence_file: "svc-a/P.java", evidence_line: 1 },
    { from_service: "queue:billing-events", to_service: "payments-module", kind: "consumes", detail: "queue:billing-events", confidence: "high", evidence_file: "payments-module/C.java", evidence_line: 5 },
  ],
  generated_at: "",
} as any;
const crInv = { services: [
  { identity: { id: "svc-a" }, http_clients: [{ framework: "feign", method: "GET", target_ref: "${payments-service.url}", path: "/api/payments/invoices/{id}", file: "svc-a/C.java", line: 3 }], queue_endpoints: [{ framework: "spring_amqp", role: "producer", queue_name: "billing-events", message_type: "InvoiceDto", file: "svc-a/P.java", line: 1 }] },
  { identity: { id: "payments-module" }, http_clients: [], queue_endpoints: [{ framework: "spring_amqp", role: "consumer", queue_name: "billing-events", message_type: "InvoiceDto", file: "payments-module/C.java", line: 5 }] },
] } as any;

describe("renderClientRegistry", () => {
  it("renders a summary (Target | Inbound Clients | Primary Callers) + per-source table", () => {
    const md = renderClientRegistry(crGraph, crInv);
    expect(md).toContain("Inbound Clients");
    expect(md).toMatch(/payments-module.*1/);          // payments-module has 1 inbound client
    expect(md).toMatch(/svc-a.*payments-module/);      // per-source: svc-a → payments-module
  });
});
describe("renderQueueRegistry", () => {
  it("renders Queue | Publisher | Consumer | Message rows from produces/consumes", () => {
    const md = renderQueueRegistry(crGraph, crInv);
    expect(md).toContain("billing-events");
    expect(md).toMatch(/billing-events.*svc-a.*payments-module/);  // queue | publisher svc-a | consumer payments-module
    expect(md).toContain("InvoiceDto");                          // message DTO
  });
});

// ── D4: renderDbTraces + renderSharedLibraryMatrix ────────────────────────────

const d4Inv = { services: [
  { identity: { id: "payments-module" }, library_deps: ["common-model"],
    orm_entities: [
      { profile: "jpa", class_name: "Invoice", table_name: "invoice", schema_name: "billing", source_file: "payments-module/Invoice.java",
        columns: [{ name: "id", source_field: "id" }, { name: "total", source_field: "total" }],
        relationships: [{ type: "one_to_many", target_entity: "Shipment" }] },
    ] },
  { identity: { id: "svc-a" }, library_deps: ["common-model", "common-messaging"], orm_entities: [] },
] } as any;
const d4Graph = { services: [
  { id: "payments-module", kind: "service", language: "java", root: "payments-module" },
  { id: "svc-a", kind: "service", language: "java", root: "svc-a" },
  { id: "common-model", kind: "library", language: "java", root: "shared/common-model" },
], edges: [
  { from_service: "payments-module", to_service: "common-model", kind: "depends_on", detail: "lib:common-model", confidence: "high", evidence_file: "payments-module/pom.xml", evidence_line: 0 },
  { from_service: "svc-a", to_service: "common-model", kind: "depends_on", detail: "lib:common-model", confidence: "high", evidence_file: "svc-a/pom.xml", evidence_line: 0 },
  { from_service: "svc-a", to_service: "common-messaging", kind: "depends_on", detail: "lib:common-messaging", confidence: "high", evidence_file: "svc-a/pom.xml", evidence_line: 0 },
], generated_at: "" } as any;

describe("renderDbTraces", () => {
  it("renders per-service entity → schema.table → relationships + a mermaid erDiagram", () => {
    const md = renderDbTraces(d4Inv);
    expect(md).toContain("payments-module");
    expect(md).toMatch(/Invoice.*billing\.invoice/);          // entity → schema.table
    expect(md).toContain("Shipment");                          // relationship
    expect(md).toContain("```mermaid");
    expect(md).toContain("erDiagram");
  });
});
describe("renderSharedLibraryMatrix", () => {
  it("renders Service | Required Libraries from depends_on", () => {
    const md = renderSharedLibraryMatrix(d4Graph, d4Inv);
    expect(md).toMatch(/svc-a.*common-model.*common-messaging/);
    expect(md).toMatch(/payments-module.*common-model/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

// Graph with a DIRECT edge (svc-a → payments-module) and a TRANSITIVE one
// (svc-c → config-service, detail starts with "via lib ").
const mixedGraph = {
  services: [
    { id: "svc-a",          kind: "service",  language: "java", root: "svc-a" },
    { id: "payments-module", kind: "service",  language: "java", root: "payments-module" },
    { id: "svc-c",          kind: "service",  language: "java", root: "svc-c" },
    { id: "config-service", kind: "service",  language: "java", root: "config-service" },
  ],
  edges: [
    // Direct call: svc-a → payments-module (high confidence, real endpoint)
    { from_service: "svc-a", to_service: "payments-module", kind: "calls",
      detail: "GET /api/x", confidence: "high",
      evidence_file: "svc-a/BillingClient.java", evidence_line: 5 },
    // Transitive call: svc-c → config-service (via shared lib)
    { from_service: "svc-c", to_service: "config-service", kind: "calls",
      detail: "via lib common-model (GET /api/y)", confidence: "medium",
      evidence_file: "shared/common-model/ConfigClient.java", evidence_line: 12 },
  ],
  generated_at: "",
} as any;
const mixedInv = { services: [] } as any;

describe("renderServiceMap", () => {
  it("renders a mermaid graph LR with service nodes + calls edges", () => {
    const md = renderServiceMap(graph, inv);
    expect(md).toContain("```mermaid");
    expect(md).toContain("graph LR");
    // both callers point at payments-module
    expect(md).toMatch(/svc.?a\b/i);
    expect(md).toContain("payments-module");
  });
  it("renders a Source | Direct Targets | Via Shared Libs dependency table from calls edges", () => {
    const md = renderServiceMap(graph, inv);
    expect(md).toContain("| Source | Direct Targets | Via Shared Libs |");
    expect(md).toMatch(/svc-a.*payments-module/);   // svc-a row lists payments-module as direct
  });
  it("excludes synthetic (ext:/queue:/table:) nodes from the service topology nodes", () => {
    const md = renderServiceMap(graph, inv);
    // ext:db is an external_source edge, not a service node in the graph LR service list
    expect(md).not.toContain("ext:db]");  // not rendered as a labeled service node box
  });

  // ── Direct vs. transitive topology tests ─────────────────────────────────
  it("includes direct edges in the mermaid graph LR block", () => {
    const md = renderServiceMap(mixedGraph, mixedInv);
    // direct edge svc-a → payments-module must appear as a Mermaid arrow
    // Mermaid ids have hyphens replaced with underscores via formatGraph
    expect(md).toMatch(/svc.?a\s*-->\s*payments.?module/i);
  });
  it("excludes transitive (via lib) edges from the mermaid graph LR block", () => {
    const md = renderServiceMap(mixedGraph, mixedInv);
    // Extract only the mermaid fenced block
    const mermaidBlock = md.match(/```mermaid[\s\S]*?```/)?.[0] ?? "";
    // svc-c → config-service must NOT appear as a topology arrow in the diagram
    expect(mermaidBlock).not.toMatch(/svc.?c\s*-->\s*config.?service/i);
  });
  it("adds a transitive-summary note when transitive edges exist", () => {
    const md = renderServiceMap(mixedGraph, mixedInv);
    expect(md).toMatch(/transitive dependenc/i);
    // Should cite the count (1 distinct transitive pair)
    expect(md).toMatch(/\b1\b.*transitive|transitive.*\b1\b/i);
    expect(md).toContain("client-registry.md");
  });
  it("omits the transitive-summary note when there are no transitive edges", () => {
    const md = renderServiceMap(graph, inv);   // graph has no "via lib" edges
    expect(md).not.toMatch(/transitive dependenc/i);
  });
  it("marks transitive-only targets in the Via Shared Libs column of the dep table", () => {
    const md = renderServiceMap(mixedGraph, mixedInv);
    // svc-c's only target (config-service) is transitive → appears in 3rd column, not 2nd
    const tableLines = md.split("\n").filter((l) => l.startsWith("| svc-c"));
    expect(tableLines.length).toBeGreaterThan(0);
    const row = tableLines[0]!;
    const cols = row.split("|").map((c) => c.trim()).filter((c) => c.length > 0);
    // cols[0]=source, cols[1]=Direct Targets, cols[2]=Via Shared Libs
    expect(cols[1]).not.toContain("config-service");  // not in Direct column
    expect(cols[2]).toContain("config-service");       // is in Via Shared Libs column
  });
  it("places direct targets in the Direct Targets column and leaves Via Shared Libs empty for all-direct sources", () => {
    const md = renderServiceMap(mixedGraph, mixedInv);
    const tableLines = md.split("\n").filter((l) => l.startsWith("| svc-a"));
    expect(tableLines.length).toBeGreaterThan(0);
    const row = tableLines[0]!;
    const cols = row.split("|").map((c) => c.trim()).filter((c) => c.length > 0);
    expect(cols[1]).toContain("payments-module");  // direct target in Direct column
    expect(cols[2]).toBe("—");                    // no transitive targets
  });
});

// ── countRealServices: AUTO-detection predicate, mirrors hasServiceTopology ──

function ident(id: string, kind: ServiceIdentity["kind"]): ServiceIdentity {
  return {
    id,
    root: id,
    aliases: [],
    kind,
    identity_source: "dir-name",
    language: "unknown",
    manifests: [],
  };
}

describe("countRealServices", () => {
  it("counts non-synthetic, non-library service identities", () => {
    const ids = [ident("svc-a", "service"), ident("svc-b", "service"), ident("admin-ui", "frontend")];
    expect(countRealServices(ids)).toBe(3);
  });

  it("excludes library identities (a lib is a dependency, not a topology service)", () => {
    const ids = [ident("svc-a", "service"), ident("common-lib", "library")];
    expect(countRealServices(ids)).toBe(1);
  });

  it("excludes synthetic-prefixed ids (ext:/queue:/table:/auth:)", () => {
    const ids = [
      ident("svc-a", "service"),
      ident("ext:http:example.com", "service"),
      ident("queue:events", "service"),
    ];
    expect(countRealServices(ids)).toBe(1);
  });

  it("returns 0 for an empty list (monolith / no services discovered)", () => {
    expect(countRealServices([])).toBe(0);
  });

  it("returns 1 for a single-service repo (monolith)", () => {
    expect(countRealServices([ident("only-svc", "service")])).toBe(1);
  });

  it("agrees with hasServiceTopology on the ≥2-real-services rule", () => {
    const two = [ident("svc-a", "service"), ident("svc-b", "service")];
    const graphTwo = {
      services: two.map((i) => ({ id: i.id, kind: i.kind, language: i.language, root: i.root })),
      edges: [],
      generated_at: "",
    } as any;
    expect(countRealServices(two) >= 2).toBe(true);
    expect(hasServiceTopology(graphTwo)).toBe(true);

    const one = [ident("svc-a", "service"), ident("lib", "library")];
    const graphOne = {
      services: one.map((i) => ({ id: i.id, kind: i.kind, language: i.language, root: i.root })),
      edges: [],
      generated_at: "",
    } as any;
    expect(countRealServices(one) >= 2).toBe(false);
    expect(hasServiceTopology(graphOne)).toBe(false);
  });
});
