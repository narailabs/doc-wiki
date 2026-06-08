import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import { makeTmpPath, cleanupTmpPath } from "./fixtures.js";
import { writeCrossServicePages } from "../cross_service_pages.js";

const SLUGS = [
  "service-map",
  "service-dependencies",
  "client-registry",
  "queue-registry",
  "database-traces",
  "shared-libraries",
] as const;

describe("writeCrossServicePages", () => {
  it("writes the six cross-service pages with atlas frontmatter", () => {
    const wiki = makeTmpPath("xs-pages");
    const RUN_ID = "2026-06-07T10-00-00";
    const inventory = {
      atlas_run_id: RUN_ID,
      services: [
        { identity: { id: "payments-module", kind: "service" }, rest_endpoints: [{ method: "GET", path: "/api/payments/x" }], http_clients: [], queue_endpoints: [], orm_entities: [], external_sources: [], library_deps: [] },
      ],
    } as any;
    const graph = { services: [{ id: "payments-module", kind: "service", language: "java", root: "payments-module" }], edges: [], generated_at: "" } as any;
    const written = writeCrossServicePages(wiki, inventory, graph);
    expect(written.length).toBe(6);
    for (const p of written) {
      expect(fs.existsSync(p)).toBe(true);
      const body = fs.readFileSync(p, "utf-8");
      expect(body.startsWith("---\n")).toBe(true);     // frontmatter
      expect(body).toContain("atlas_facet: architecture");
      expect(body).toContain(`atlas_run_id: ${RUN_ID}`);
    }
    for (const slug of SLUGS) {
      const match = written.find((p) => p.endsWith(`${slug}.md`));
      expect(match, `missing page: ${slug}`).toBeTruthy();
      const body = fs.readFileSync(match!, "utf-8");
      expect(body).toContain(`cross_service_page: ${slug}`);
    }
    cleanupTmpPath(wiki);
  });
});
