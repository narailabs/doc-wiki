import { describe, it, expect } from "vitest";
import { normalizePath, resolveTargetService, buildServiceGraph, rankInbound, detectCycles } from "../cross_service_edges.js";

describe("normalizePath", () => {
  it("sentinelizes param segments regardless of syntax", () => {
    expect(normalizePath("/users/{id}")).toBe("/users/{}");
    expect(normalizePath("/users/${userId}")).toBe("/users/{}");
    expect(normalizePath("/users/:id")).toBe("/users/{}");
    expect(normalizePath("/stores/{storeId:\\d+}")).toBe("/stores/{}");
    expect(normalizePath("/items/<int:id>")).toBe("/items/{}");
    expect(normalizePath("/x/[id]")).toBe("/x/{}");
    expect(normalizePath("http://svc/users/{id}?q=1")).toBe("/users/{}");
    expect(normalizePath("//a//b/")).toBe("/a/b");
    expect(normalizePath("users/list")).toBe("/users/list");
  });
});

describe("resolveTargetService", () => {
  const services = [
    { id: "payments-module", root: "payments-module", aliases: ["payments-service.url", "payments"], kind: "service", identity_source: "dir-name", language: "java", manifests: ["pom.xml"] },
    { id: "settings-service", root: "settings-service", aliases: ["config-service.url", "configuration"], kind: "service", identity_source: "dir-name", language: "java", manifests: ["pom.xml"] },
  ] as any;
  it("resolves a k8s host", () => {
    expect(resolveTargetService("http://payments-api/api/payments/x", services)?.id).toBe("payments-module");
  });
  it("resolves a ${prop} alias", () => {
    expect(resolveTargetService("${config-service.url}", services)?.id).toBe("settings-service");
  });
  it("resolves a Feign logical service name", () => {
    expect(resolveTargetService("settings-service", services)?.id).toBe("settings-service");
  });
  it("resolves a /api/{seg}/ path segment", () => {
    expect(resolveTargetService("/api/payments/invoices", services)?.id).toBe("payments-module");
  });
  it("returns undefined for an unknown external host", () => {
    expect(resolveTargetService("https://api.stripe.com/v1/charges", services)).toBeUndefined();
  });
});

// ── buildServiceGraph helpers ─────────────────────────────────────────

function svc(id: string, over: any = {}) {
  return {
    identity: {
      id, root: id,
      aliases: [id.replace(/-(module|service|svc)$/, "")],
      kind: "service",
      identity_source: "dir-name", language: "java", manifests: ["pom.xml"],
    },
    project_metadata: { name: id, version: "1", language: "java", runtime: "java", manifests_seen: ["pom.xml"] },
    orm_entities: [], rest_endpoints: [], http_clients: [], queue_endpoints: [], external_sources: [],
    library_deps: [], auth_issuer: "",
    ...over,
  };
}

const baseInv = (services: any[]) => ({
  atlas_run_id: "2026-06-07T10-00-00", generated_at: "", repo_root: "/r",
  project_metadata: { name: "", version: "", language: "", runtime: "", manifests_seen: [] },
  orm_entities: [], rest_endpoints: [], code_clients: [], services,
  stats: { files_walked: 0, files_skipped_for_size: 0, duration_ms: 0 }, notes: [],
});

describe("buildServiceGraph", () => {
  it("emits a calls edge when a client path matches a target service endpoint", () => {
    const inv = baseInv([
      svc("svc-a", {
        http_clients: [{ framework: "feign", method: "GET", target_ref: "${payments-service.url}", path: "/api/payments/invoices/{id}", file: "svc-a/C.java", line: 3 }],
      }),
      svc("payments-module", {
        identity: {
          id: "payments-module", root: "payments-module",
          aliases: ["payments-service.url", "payments"],
          kind: "service", identity_source: "dir-name", language: "java", manifests: ["pom.xml"],
        },
        rest_endpoints: [{ framework: "spring", method: "GET", path: "/api/payments/invoices/{id}", file: "payments-module/R.java", line: 9 }],
      }),
    ]);
    const g = buildServiceGraph(inv);
    const calls = g.edges.find((e) => e.kind === "calls");
    expect(calls).toBeTruthy();
    expect(calls!.from_service).toBe("svc-a");
    expect(calls!.to_service).toBe("payments-module");
    expect(calls!.confidence).toBe("high");
  });

  it("emits produces+consumes edges for a queue matched across services", () => {
    const inv = baseInv([
      svc("a", { queue_endpoints: [{ framework: "spring_amqp", role: "producer", queue_name: "events", file: "a/P.java", line: 1 }] }),
      svc("b", { queue_endpoints: [{ framework: "spring_amqp", role: "consumer", queue_name: "events", file: "b/C.java", line: 1 }] }),
    ]);
    const g = buildServiceGraph(inv);
    expect(g.edges.some((e) => e.kind === "produces" && e.from_service === "a")).toBe(true);
    expect(g.edges.some((e) => e.kind === "consumes" && e.to_service === "b")).toBe(true);
  });

  // Exchange→queue binding indirection: a producer sends to an EXCHANGE
  // (orders-ex) with a routing key (order.created); the consumer listens on a
  // QUEUE (orders-q) bound to that exchange. A binding (orders-ex, order.created)
  // → orders-q lets buildServiceGraph bridge the producer to the bound queue so
  // the produces/consumes path connects on queue:orders-q.
  it("bridges producer(exchange/routing-key) → bound queue → consumer via a queue binding", () => {
    const inv = baseInv([
      svc("a", {
        queue_endpoints: [{ framework: "spring_amqp", role: "producer", queue_name: "orders-ex", file: "a/P.java", line: 1 }],
        queue_bindings: [{ queue_name: "orders-q", exchange: "orders-ex", routing_key: "order.created", file: "a/Cfg.java", line: 2 }],
      }),
      svc("b", {
        queue_endpoints: [{ framework: "spring_amqp", role: "consumer", queue_name: "orders-q", file: "b/C.java", line: 1 }],
      }),
    ]);
    const g = buildServiceGraph(inv);
    // Producer connects to the BOUND queue, not just the raw exchange/routing-key.
    expect(g.edges.some((e) => e.kind === "produces" && e.from_service === "a" && e.to_service === "queue:orders-q")).toBe(true);
    expect(g.edges.some((e) => e.kind === "consumes" && e.from_service === "queue:orders-q" && e.to_service === "b")).toBe(true);
  });

  // The binding's routing_key side also bridges: a producer whose captured name
  // is the ROUTING KEY (not the exchange) still resolves to the bound queue.
  it("bridges a producer keyed on the routing-key to the bound queue", () => {
    const inv = baseInv([
      svc("a", {
        queue_endpoints: [{ framework: "spring_amqp", role: "producer", queue_name: "order.created", file: "a/P.java", line: 1 }],
        queue_bindings: [{ queue_name: "orders-q", exchange: "orders-ex", routing_key: "order.created", file: "a/Cfg.java", line: 2 }],
      }),
      svc("b", {
        queue_endpoints: [{ framework: "spring_amqp", role: "consumer", queue_name: "orders-q", file: "b/C.java", line: 1 }],
      }),
    ]);
    const g = buildServiceGraph(inv);
    expect(g.edges.some((e) => e.kind === "produces" && e.from_service === "a" && e.to_service === "queue:orders-q")).toBe(true);
    expect(g.edges.some((e) => e.kind === "consumes" && e.from_service === "queue:orders-q" && e.to_service === "b")).toBe(true);
  });

  it("emits external_source edges for datasources and for unresolved (external) client hosts", () => {
    const inv = baseInv([
      svc("a", {
        external_sources: [{ kind: "database", detail: "jdbc:postgresql://pg/x", connector_id: "db", configured: true, file: "a/app.yml", line: 2 }],
        http_clients: [{ framework: "axios", method: "GET", target_ref: "https://api.stripe.com", path: "https://api.stripe.com/v1/charges", file: "a/s.ts", line: 4 }],
      }),
    ]);
    const g = buildServiceGraph(inv);
    expect(g.edges.some((e) => e.kind === "external_source" && e.detail.includes("db"))).toBe(true);
    // unresolved external client host → http_external external_source edge
    expect(g.edges.some((e) => e.kind === "external_source" && e.to_service.startsWith("ext:"))).toBe(true);
  });

  it("rankInbound + detectCycles work", () => {
    const inv = baseInv([
      svc("a", {
        http_clients: [{ framework: "feign", method: "GET", target_ref: "b", path: "/api/b/x", file: "a/C.java", line: 1 }],
      }),
      svc("b", {
        identity: { id: "b", root: "b", aliases: ["b"], kind: "service", identity_source: "dir-name", language: "java", manifests: ["pom.xml"] },
        rest_endpoints: [{ framework: "spring", method: "GET", path: "/api/b/x", file: "b/R.java", line: 1 }],
      }),
    ]);
    const g = buildServiceGraph(inv);
    expect(rankInbound(g).find((r) => r.service === "b")?.count).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(detectCycles(g))).toBe(true);
  });
});

// ── BUG 1: detectCycles must report every member of a convergent cycle ──

/** Build a minimal ServiceGraph literal with only `calls` edges between ids. */
function callsGraph(ids: string[], edges: Array<[string, string]>): any {
  return {
    services: ids.map((id) => ({ id, kind: "service", language: "java", root: id })),
    edges: edges.map(([from, to]) => ({
      from_service: from, to_service: to, kind: "calls",
      detail: `GET /x`, confidence: "high", evidence_file: `${from}/C.java`, evidence_line: 1,
    })),
    generated_at: "",
  };
}

describe("detectCycles (BUG 1 — convergent cycles)", () => {
  it("reports ALL members of a cycle where two paths converge on the same back-edge node", () => {
    // A→B→C→A AND A→D→C→A. Every node reaches every other through C→A, so the
    // whole set {A,B,C,D} is one SCC. The old 3-color DFS missed D.
    const g = callsGraph(
      ["A", "B", "C", "D"],
      [["A", "B"], ["B", "C"], ["C", "A"], ["A", "D"], ["D", "C"]],
    );
    const cycles = detectCycles(g);
    const members = new Set(cycles.flat());
    expect(members.has("A")).toBe(true);
    expect(members.has("B")).toBe(true);
    expect(members.has("C")).toBe(true);
    expect(members.has("D")).toBe(true);
  });

  it("reports no cycles for a pure DAG", () => {
    const g = callsGraph(["A", "B", "C"], [["A", "B"], ["B", "C"]]);
    expect(detectCycles(g)).toEqual([]);
  });

  it("reports a self-loop node (A→A)", () => {
    const g = callsGraph(["A"], [["A", "A"]]);
    const members = new Set(detectCycles(g).flat());
    expect(members.has("A")).toBe(true);
  });
});

// ── BUG 3: path-fallback must not emit spurious medium edges ──

describe("buildServiceGraph path-fallback guard (BUG 3)", () => {
  it("does NOT emit a calls edge when path-fallback resolves a service with no matching endpoint", () => {
    const inv = baseInv([
      svc("caller", {
        http_clients: [{ framework: "axios", method: "GET", target_ref: "", path: "/api/users", file: "caller/c.ts", line: 1 }],
      }),
      svc("users-service", {
        identity: { id: "users-service", root: "users-service", aliases: ["users"], kind: "service", identity_source: "dir-name", language: "java", manifests: ["pom.xml"] },
        rest_endpoints: [{ framework: "spring", method: "GET", path: "/api/users/{id}", file: "users-service/R.java", line: 1 }],
      }),
    ]);
    const g = buildServiceGraph(inv);
    expect(g.edges.some((e) => e.kind === "calls")).toBe(false);
  });

  it("emits a high calls edge when path-fallback resolves a service WITH a matching endpoint", () => {
    const inv = baseInv([
      svc("caller", {
        http_clients: [{ framework: "axios", method: "GET", target_ref: "", path: "/api/users", file: "caller/c.ts", line: 1 }],
      }),
      svc("users-service", {
        identity: { id: "users-service", root: "users-service", aliases: ["users"], kind: "service", identity_source: "dir-name", language: "java", manifests: ["pom.xml"] },
        rest_endpoints: [{ framework: "spring", method: "GET", path: "/api/users", file: "users-service/R.java", line: 1 }],
      }),
    ]);
    const g = buildServiceGraph(inv);
    const calls = g.edges.find((e) => e.kind === "calls");
    expect(calls).toBeTruthy();
    expect(calls!.to_service).toBe("users-service");
    expect(calls!.confidence).toBe("high");
  });
});

// ── BUG 4: template-aware path matching (concrete ids vs {param}) ──

describe("buildServiceGraph template-aware path matching (BUG 4)", () => {
  it("matches a concrete id path against a {param} endpoint with high confidence", () => {
    const inv = baseInv([
      svc("orders-caller", {
        http_clients: [{ framework: "feign", method: "GET", target_ref: "${orders-service.url}", path: "/api/orders/12345", file: "orders-caller/c.java", line: 1 }],
      }),
      svc("orders-service", {
        identity: { id: "orders-service", root: "orders-service", aliases: ["orders-service.url", "orders"], kind: "service", identity_source: "dir-name", language: "java", manifests: ["pom.xml"] },
        rest_endpoints: [{ framework: "spring", method: "GET", path: "/api/orders/{id}", file: "orders-service/R.java", line: 1 }],
      }),
    ]);
    const g = buildServiceGraph(inv);
    const calls = g.edges.find((e) => e.kind === "calls");
    expect(calls).toBeTruthy();
    expect(calls!.to_service).toBe("orders-service");
    expect(calls!.confidence).toBe("high");
  });
});

// ── depends_on (shared-library) + auth_via (issuer) edges ────────────

describe("buildServiceGraph depends_on + auth_via edges", () => {
  it("emits a depends_on edge from a service to a discovered library it depends on", () => {
    const inv = baseInv([
      svc("svc-a", { library_deps: ["common-model"] }),
      svc("common-model", {
        identity: { id: "common-model", root: "shared/common-model", aliases: ["common-model"], kind: "library", identity_source: "dir-name", language: "java", manifests: ["pom.xml"] },
      }),
    ]);
    const g = buildServiceGraph(inv);
    const dep = g.edges.find((e) => e.kind === "depends_on");
    expect(dep).toBeTruthy();
    expect(dep!.from_service).toBe("svc-a");
    expect(dep!.to_service).toBe("common-model");
    expect(dep!.confidence).toBe("high");
    expect(dep!.detail).toBe("lib:common-model");
    expect(dep!.evidence_file).toBe("svc-a/pom.xml");
  });

  it("evidence_file for depends_on points at the ACTUAL (nested) pom when pom_path differs from root/pom.xml", () => {
    // Service `feed` has root=`feed` but its real pom is `feed/project/pom.xml`.
    // The depends_on edge evidence must point at the actual pom, not the phantom `feed/pom.xml`.
    const inv = baseInv([
      svc("feed", {
        library_deps: ["common-model"],
        pom_path: "feed/project/pom.xml",
      }),
      svc("common-model", {
        identity: { id: "common-model", root: "shared/common-model", aliases: ["common-model"], kind: "library", identity_source: "dir-name", language: "java", manifests: ["pom.xml"] },
      }),
    ]);
    const g = buildServiceGraph(inv);
    const dep = g.edges.find((e) => e.kind === "depends_on" && e.from_service === "feed");
    expect(dep).toBeTruthy();
    expect(dep!.evidence_file).toBe("feed/project/pom.xml");
    expect(dep!.evidence_file).not.toBe("feed/pom.xml");
  });

  it("evidence_file for depends_on falls back to root/pom.xml when pom_path is absent (normal layout)", () => {
    // Normal service: no pom_path override, evidence stays at svc-a/pom.xml.
    const inv = baseInv([
      svc("svc-a", { library_deps: ["common-model"] }),
      svc("common-model", {
        identity: { id: "common-model", root: "shared/common-model", aliases: ["common-model"], kind: "library", identity_source: "dir-name", language: "java", manifests: ["pom.xml"] },
      }),
    ]);
    const g = buildServiceGraph(inv);
    const dep = g.edges.find((e) => e.kind === "depends_on" && e.from_service === "svc-a");
    expect(dep).toBeTruthy();
    expect(dep!.evidence_file).toBe("svc-a/pom.xml");
  });

  it("emits an auth_via edge from a service with a non-empty auth_issuer", () => {
    const inv = baseInv([
      svc("svc-a", { auth_issuer: "https://auth.example.com/" }),
    ]);
    const g = buildServiceGraph(inv);
    const auth = g.edges.find((e) => e.kind === "auth_via");
    expect(auth).toBeTruthy();
    expect(auth!.from_service).toBe("svc-a");
    expect(auth!.to_service).toBe("auth:auth.example.com");
    expect(auth!.confidence).toBe("high");
    expect(auth!.detail).toBe("issuer:https://auth.example.com/");
  });

  it("does not emit a depends_on edge when library_deps is empty", () => {
    const inv = baseInv([svc("svc-a")]);
    const g = buildServiceGraph(inv);
    expect(g.edges.some((e) => e.kind === "depends_on")).toBe(false);
  });

  it("does not emit an auth_via edge when auth_issuer is empty string", () => {
    const inv = baseInv([svc("svc-a")]);
    const g = buildServiceGraph(inv);
    expect(g.edges.some((e) => e.kind === "auth_via")).toBe(false);
  });
});

// ── T3: transitive Feign client attribution ────────────────────────────

describe("buildServiceGraph transitive Feign attribution (T3)", () => {
  it("attributes a library's Feign client transitively to depending services", () => {
    const inv = {
      atlas_run_id: "x", generated_at: "", repo_root: "/r",
      project_metadata: { name: "", version: "", language: "", runtime: "", manifests_seen: [] },
      orm_entities: [], rest_endpoints: [], code_clients: [], stats: { files_walked: 0, files_skipped_for_size: 0, duration_ms: 0 }, notes: [],
      services: [
        // library with a Feign client to settings-service
        { identity: { id: "common-model", root: "shared/common-model", aliases: [], kind: "library", identity_source: "dir-name", language: "java", manifests: ["pom.xml"] },
          project_metadata: {}, orm_entities: [], rest_endpoints: [],
          http_clients: [{ framework: "feign", method: "GET", target_ref: "settings-service", path: "/api/config/x", file: "shared/common-model/C.java", line: 1, resolved_target: undefined }],
          queue_endpoints: [], external_sources: [], library_deps: [], auth_issuer: "" },
        // settings-service (the target)
        { identity: { id: "settings-service", root: "settings-service", aliases: ["configuration"], kind: "service", identity_source: "dir-name", language: "java", manifests: ["pom.xml"] },
          project_metadata: {}, orm_entities: [], rest_endpoints: [{ framework: "spring", method: "GET", path: "/api/config/x", file: "settings-service/R.java", line: 1 }],
          http_clients: [], queue_endpoints: [], external_sources: [], library_deps: [], auth_issuer: "" },
        // payments-module depends on common-model but has NO own Feign client
        { identity: { id: "payments-module", root: "payments-module", aliases: [], kind: "service", identity_source: "dir-name", language: "java", manifests: ["pom.xml"] },
          project_metadata: {}, orm_entities: [], rest_endpoints: [],
          http_clients: [], queue_endpoints: [], external_sources: [], library_deps: ["common-model"], auth_issuer: "" },
      ],
    } as any;
    const g = buildServiceGraph(inv);
    // direct lib edge
    expect(g.edges.some((e) => e.kind === "calls" && e.from_service === "common-model" && e.to_service === "settings-service")).toBe(true);
    // transitive consumer edge
    const t = g.edges.find((e) => e.kind === "calls" && e.from_service === "payments-module" && e.to_service === "settings-service");
    expect(t).toBeTruthy();
    expect(t!.confidence).toBe("medium");
    expect(t!.detail).toContain("via lib");
  });

  it("keeps the full nested client path on a propagated transitive edge (not basename-collapsed)", () => {
    const inv = {
      atlas_run_id: "x", generated_at: "", repo_root: "/r",
      project_metadata: { name: "", version: "", language: "", runtime: "", manifests_seen: [] },
      orm_entities: [], rest_endpoints: [], code_clients: [], stats: { files_walked: 0, files_skipped_for_size: 0, duration_ms: 0 }, notes: [],
      services: [
        // library with a deeply-nested Feign client file
        { identity: { id: "common-model", root: "shared/common-model", aliases: [], kind: "library", identity_source: "dir-name", language: "java", manifests: ["pom.xml"] },
          project_metadata: {}, orm_entities: [], rest_endpoints: [],
          http_clients: [{ framework: "feign", method: "GET", target_ref: "config-service", path: "/api/config/x",
            file: "shared/common-model/src/main/java/x/ConfigClient.java", line: 5, resolved_target: undefined }],
          queue_endpoints: [], external_sources: [], library_deps: [], auth_issuer: "" },
        // config-service (the target)
        { identity: { id: "config-service", root: "config-service", aliases: ["configuration"], kind: "service", identity_source: "dir-name", language: "java", manifests: ["pom.xml"] },
          project_metadata: {}, orm_entities: [], rest_endpoints: [{ framework: "spring", method: "GET", path: "/api/config/x", file: "config-service/R.java", line: 1 }],
          http_clients: [], queue_endpoints: [], external_sources: [], library_deps: [], auth_issuer: "" },
        // svc-a depends on common-model
        { identity: { id: "svc-a", root: "svc-a", aliases: [], kind: "service", identity_source: "dir-name", language: "java", manifests: ["pom.xml"] },
          project_metadata: {}, orm_entities: [], rest_endpoints: [],
          http_clients: [], queue_endpoints: [], external_sources: [], library_deps: ["common-model"], auth_issuer: "" },
      ],
    } as any;
    const g = buildServiceGraph(inv);
    const t = g.edges.find((e) => e.kind === "calls" && e.from_service === "svc-a" && e.to_service === "config-service");
    expect(t).toBeTruthy();
    // evidence_file must be the FULL nested path, not the basename-collapsed version
    expect(t!.evidence_file).toBe("shared/common-model/src/main/java/x/ConfigClient.java");
    expect(t!.evidence_file).not.toBe("shared/common-model/ConfigClient.java");
  });

  it("does NOT emit a transitive edge when a direct calls edge already exists for S→T", () => {
    const inv = {
      atlas_run_id: "x", generated_at: "", repo_root: "/r",
      project_metadata: { name: "", version: "", language: "", runtime: "", manifests_seen: [] },
      orm_entities: [], rest_endpoints: [], code_clients: [], stats: { files_walked: 0, files_skipped_for_size: 0, duration_ms: 0 }, notes: [],
      services: [
        { identity: { id: "common-model", root: "shared/common-model", aliases: [], kind: "library", identity_source: "dir-name", language: "java", manifests: ["pom.xml"] },
          project_metadata: {}, orm_entities: [], rest_endpoints: [],
          http_clients: [{ framework: "feign", method: "GET", target_ref: "settings-service", path: "/api/config/x", file: "shared/common-model/C.java", line: 1, resolved_target: undefined }],
          queue_endpoints: [], external_sources: [], library_deps: [], auth_issuer: "" },
        { identity: { id: "settings-service", root: "settings-service", aliases: ["configuration"], kind: "service", identity_source: "dir-name", language: "java", manifests: ["pom.xml"] },
          project_metadata: {}, orm_entities: [], rest_endpoints: [{ framework: "spring", method: "GET", path: "/api/config/x", file: "settings-service/R.java", line: 1 }],
          http_clients: [], queue_endpoints: [], external_sources: [], library_deps: [], auth_issuer: "" },
        // payments-module ALSO has a direct Feign client to settings-service
        { identity: { id: "payments-module", root: "payments-module", aliases: [], kind: "service", identity_source: "dir-name", language: "java", manifests: ["pom.xml"] },
          project_metadata: {}, orm_entities: [], rest_endpoints: [],
          http_clients: [{ framework: "feign", method: "GET", target_ref: "settings-service", path: "/api/config/x", file: "payments-module/DirectClient.java", line: 5, resolved_target: undefined }],
          queue_endpoints: [], external_sources: [], library_deps: ["common-model"], auth_issuer: "" },
      ],
    } as any;
    const g = buildServiceGraph(inv);
    // Only one calls edge from payments-module → settings-service (the direct one)
    const callEdges = g.edges.filter((e) => e.kind === "calls" && e.from_service === "payments-module" && e.to_service === "settings-service");
    expect(callEdges.length).toBe(1);
    expect(callEdges[0]!.detail).not.toContain("via lib"); // the direct edge, not the transitive one
  });
});
