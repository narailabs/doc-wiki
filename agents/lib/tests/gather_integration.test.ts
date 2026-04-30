/**
 * Tests the seam between @narai/connector-hub's `gather()` and the wiki-side
 * `applyMermaid()` decoration. Step 7 of /doc-wiki:ingest depends on this contract:
 *
 *   const { results } = await gather({ prompt, consumer: "doc-wiki" });
 *   const augmented = results.map(applyMermaid);
 *
 * This test fixtures the `gather()` output for all 7 builtin connectors plus
 * the failure modes the hub emits (error, non-structural action, malformed
 * envelope) and asserts that `applyMermaid` produces the shape `mermaid_inject.js`
 * (step 9) consumes — i.e. either an envelope with a `mermaid: { type, title, code }`
 * field, or a passthrough.
 *
 * Direct unit coverage of each transformer lives in `mermaid_augment.test.ts`.
 * This file covers the orchestration: `results.map(applyMermaid)` over a
 * realistic mixed batch.
 */
import { describe, expect, it } from "vitest";
import type { DispatchResult } from "narai-primitives";

import { applyMermaid, SUPPORTED_CONNECTORS } from "../mermaid_augment.js";

// ── Fixtures: a realistic gather() output ────────────────────────────

/**
 * One DispatchResult per builtin connector, plus three failure shapes.
 * Models the hub's actual return shape (per @narai/connector-hub README):
 *   { step, connector, action, params, envelope?, error? }
 */
function fakeGatherOutput(): DispatchResult[] {
  return [
    // 1. AWS — list_functions (structural, should get mermaid)
    {
      step: 0,
      connector: "aws",
      action: "list_functions",
      params: { region: "us-east-1" },
      envelope: {
        status: "success",
        action: "list_functions",
        data: {
          region: "us-east-1",
          functions: [
            { name: "ingest-handler", runtime: "nodejs20.x" },
            { name: "transform-handler", runtime: "nodejs20.x" },
          ],
        },
      },
    },
    // 2. GCP — list_services (structural, should get mermaid)
    {
      step: 1,
      connector: "gcp",
      action: "list_services",
      params: { project_id: "my-proj" },
      envelope: {
        status: "success",
        action: "list_services",
        data: {
          project_id: "my-proj",
          services: [
            { name: "api-gateway", title: "API Gateway" },
            { name: "worker-pool", title: "Worker Pool" },
          ],
        },
      },
    },
    // 3. Jira — jql_search (structural, should get mermaid)
    {
      step: 2,
      connector: "jira",
      action: "jql_search",
      params: { jql: "project = AUTH" },
      envelope: {
        status: "success",
        action: "jql_search",
        data: {
          issues: [
            { key: "AUTH-1", status: "Done", summary: "Login flow" },
            { key: "AUTH-2", status: "In Progress", summary: "MFA" },
          ],
        },
      },
    },
    // 4. Confluence — cql_search (structural, should get mermaid)
    {
      step: 3,
      connector: "confluence",
      action: "cql_search",
      params: { cql: "space = ARCH" },
      envelope: {
        status: "success",
        action: "cql_search",
        data: {
          pages: [
            { space_key: "ARCH", title: "Architecture overview" },
            { space_key: "ARCH", title: "Auth design" },
          ],
        },
      },
    },
    // 5. Notion — search (structural, should get mermaid)
    {
      step: 4,
      connector: "notion",
      action: "search",
      params: { query: "auth" },
      envelope: {
        status: "success",
        action: "search",
        data: {
          results: [
            { id: "page-1", object_type: "page" },
            { id: "page-2", object_type: "page" },
          ],
        },
      },
    },
    // 6. GitHub — get_file (structural for package.json, should get mermaid)
    {
      step: 5,
      connector: "github",
      action: "get_file",
      params: { owner: "acme", repo: "svc", path: "package.json" },
      envelope: {
        status: "success",
        action: "get_file",
        data: {
          path: "package.json",
          content: JSON.stringify({
            name: "svc",
            dependencies: { express: "^4.0.0", pg: "^8.0.0" },
          }),
        },
      },
    },
    // 7. DB — schema (erDiagram path; db-agent envelope uses status:"ok" + top-level tables)
    {
      step: 6,
      connector: "db",
      action: "schema",
      params: { env: "dev" },
      envelope: {
        status: "ok",
        tables: [
          {
            name: "users",
            columns: [
              { name: "id", data_type: "uuid", is_primary_key: true },
              { name: "email", data_type: "varchar" },
            ],
          },
          {
            name: "sessions",
            columns: [
              { name: "id", data_type: "uuid", is_primary_key: true },
              { name: "user_id", data_type: "uuid" },
            ],
          },
        ],
      },
    },
    // Failure shapes the hub can emit:

    // 8. Error result (planner failure / spawn failure / non-JSON stdout)
    {
      step: 7,
      connector: "github",
      action: "search_code",
      params: { q: "broken-token" },
      error: { code: "AUTH_ERROR", message: "Invalid GitHub token" },
    },
    // 9. Non-structural action (success but applyMermaid should skip)
    {
      step: 8,
      connector: "github",
      action: "search_code",
      params: { q: "TODO" },
      envelope: {
        status: "success",
        action: "search_code",
        data: { results: [{ path: "src/x.ts" }] },
      },
    },
    // 10. Unknown connector (custom from wiki.config.yaml; applyMermaid passthrough)
    {
      step: 9,
      connector: "linear",
      action: "list_issues",
      params: {},
      envelope: { status: "success", action: "list_issues", data: { issues: [] } },
    },
  ];
}

// ── Tests ─────────────────────────────────────────────────────────────

describe("gather() → applyMermaid() seam", () => {
  it("covers all 7 builtin connectors in the SUPPORTED_CONNECTORS set", () => {
    const fixture = fakeGatherOutput();
    const builtinHits = fixture
      .map((r) => r.connector)
      .filter((c) => SUPPORTED_CONNECTORS.has(c));
    // Each of the 7 builtin connectors appears at least once in the fixture
    expect(new Set(builtinHits)).toEqual(
      new Set(["aws", "gcp", "jira", "confluence", "notion", "github", "db"]),
    );
  });

  it("attaches mermaid to all 7 structural connector results", () => {
    const fixture = fakeGatherOutput();
    const augmented = fixture.map(applyMermaid);

    // The first 7 are structural-action successes — each must have mermaid
    for (const i of [0, 1, 2, 3, 4, 5, 6]) {
      const env = augmented[i]!.envelope as Record<string, unknown>;
      const mermaid = env["mermaid"] as { type?: string; title?: string; code?: string } | undefined;
      expect(mermaid, `step ${i} (${augmented[i]!.connector}) should have mermaid`).toBeDefined();
      expect(typeof mermaid!.type).toBe("string");
      expect(typeof mermaid!.title).toBe("string");
      expect(typeof mermaid!.code).toBe("string");
      expect(mermaid!.code!.length).toBeGreaterThan(0);
    }
  });

  it("uses erDiagram for db, graph LR for github get_file, graph TB for the rest", () => {
    const augmented = fakeGatherOutput().map(applyMermaid);

    const typeOf = (idx: number): string | undefined => {
      const env = augmented[idx]!.envelope as Record<string, unknown>;
      const mermaid = env["mermaid"] as { type?: string } | undefined;
      return mermaid?.type;
    };

    expect(typeOf(0)).toBe("graph TB"); // aws
    expect(typeOf(1)).toBe("graph TB"); // gcp
    expect(typeOf(2)).toBe("graph TB"); // jira
    expect(typeOf(3)).toBe("graph TB"); // confluence
    expect(typeOf(4)).toBe("graph TB"); // notion
    expect(typeOf(5)).toBe("graph LR"); // github get_file
    expect(typeOf(6)).toBe("erDiagram"); // db schema
  });

  it("passes error results through unchanged", () => {
    const fixture = fakeGatherOutput();
    const augmented = fixture.map(applyMermaid);

    const errorResult = augmented[7]!;
    expect(errorResult).toBe(fixture[7]); // identity — input returned as-is
    expect(errorResult.error).toEqual({ code: "AUTH_ERROR", message: "Invalid GitHub token" });
    expect(errorResult.envelope).toBeUndefined();
  });

  it("leaves non-structural successful envelopes untouched", () => {
    const fixture = fakeGatherOutput();
    const augmented = fixture.map(applyMermaid);

    // GitHub search_code is not a structural action — applyMermaid skips it
    const nonStructural = augmented[8]!;
    const env = nonStructural.envelope as Record<string, unknown>;
    expect(env["mermaid"]).toBeUndefined();
  });

  it("passes unknown-connector envelopes through (custom registry agents)", () => {
    const fixture = fakeGatherOutput();
    const augmented = fixture.map(applyMermaid);

    const custom = augmented[9]!;
    expect(custom.connector).toBe("linear");
    const env = custom.envelope as Record<string, unknown>;
    expect(env["mermaid"]).toBeUndefined();
  });

  it("preserves step / connector / action / params on every entry", () => {
    const fixture = fakeGatherOutput();
    const augmented = fixture.map(applyMermaid);

    for (let i = 0; i < fixture.length; i++) {
      expect(augmented[i]!.step).toBe(fixture[i]!.step);
      expect(augmented[i]!.connector).toBe(fixture[i]!.connector);
      expect(augmented[i]!.action).toBe(fixture[i]!.action);
      expect(augmented[i]!.params).toEqual(fixture[i]!.params);
    }
  });

  it("does not mutate the input array or its entries", () => {
    const fixture = fakeGatherOutput();
    const beforeJson = JSON.stringify(fixture);
    fixture.map(applyMermaid);
    expect(JSON.stringify(fixture)).toBe(beforeJson);
  });
});
