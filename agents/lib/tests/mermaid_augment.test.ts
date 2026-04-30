/**
 * Tests for mermaid_augment.ts — apply Mermaid blocks to raw connector envelopes
 * returned by `@narai/connector-hub`'s `gather()`.
 *
 * Each describe block covers one connector short name. We assert:
 *  - happy path: a structural envelope gets a `mermaid: { type, title, code }`
 *    field attached that matches the wrapper's diagram type.
 *  - skip path: empty data (or a non-structural action) leaves the envelope
 *    unchanged.
 */
import { describe, expect, it } from "vitest";
import type { DispatchResult } from "narai-primitives";

import {
  SUPPORTED_CONNECTORS,
  applyMermaid,
} from "../mermaid_augment.js";

function makeResult(connector: string, envelope: unknown, action = "x"): DispatchResult {
  return {
    step: 0,
    connector,
    action,
    params: {},
    envelope,
  };
}

describe("applyMermaid — passthrough cases", () => {
  it("returns input unchanged when result has an error", () => {
    const input: DispatchResult = {
      step: 0,
      connector: "aws",
      action: "list_functions",
      params: {},
      error: { code: "X", message: "y" },
    };
    expect(applyMermaid(input)).toBe(input);
  });

  it("returns input unchanged for an unknown connector", () => {
    const input = makeResult("unknown-svc", {
      status: "success",
      action: "list_functions",
      data: { functions: [] },
    });
    expect(applyMermaid(input)).toBe(input);
  });

  it("returns input unchanged for a non-object envelope", () => {
    const input = makeResult("aws", "raw-string");
    expect(applyMermaid(input)).toBe(input);
  });

  it("returns input unchanged when transformer rejects (status != success)", () => {
    const input = makeResult("aws", {
      status: "error",
      action: "list_functions",
      data: { functions: [{ name: "f", runtime: "nodejs20.x" }] },
    });
    expect(applyMermaid(input)).toBe(input);
  });
});

describe("applyMermaid — aws", () => {
  it("attaches a graph TB diagram for list_functions", () => {
    const out = applyMermaid(
      makeResult("aws", {
        status: "success",
        action: "list_functions",
        data: {
          region: "us-east-1",
          functions: [{ name: "fn1", runtime: "nodejs20.x" }],
        },
      }),
    );
    const env = out.envelope as Record<string, unknown>;
    expect(env["mermaid"]).toMatchObject({
      type: "graph TB",
      title: "AWS Lambda Functions — us-east-1",
    });
  });

  it("skips when functions list is empty", () => {
    const input = makeResult("aws", {
      status: "success",
      action: "list_functions",
      data: { region: "us-east-1", functions: [] },
    });
    expect(applyMermaid(input)).toBe(input);
  });
});

describe("applyMermaid — gcp", () => {
  it("attaches a graph TB diagram for list_services", () => {
    const out = applyMermaid(
      makeResult("gcp", {
        status: "success",
        action: "list_services",
        data: {
          project_id: "p1",
          services: [{ name: "svc1.googleapis.com", title: "Service One" }],
        },
      }),
    );
    const env = out.envelope as Record<string, unknown>;
    expect(env["mermaid"]).toMatchObject({
      type: "graph TB",
      title: "GCP Services — p1",
    });
  });
});

describe("applyMermaid — jira", () => {
  it("groups issues by status under a root node", () => {
    const out = applyMermaid(
      makeResult("jira", {
        status: "success",
        action: "jql_search",
        data: {
          issues: [
            { key: "AUTH-1", status: "Open", summary: "Login broken" },
            { key: "AUTH-2", status: "Done", summary: "Add 2FA" },
          ],
        },
      }),
    );
    const env = out.envelope as Record<string, unknown>;
    expect(env["mermaid"]).toMatchObject({
      type: "graph TB",
      title: "Issue Status Tree",
    });
    const code = (env["mermaid"] as Record<string, unknown>)["code"] as string;
    expect(code).toContain("AUTH-1");
    expect(code).toContain("Open");
  });

  it("skips when issues list is empty", () => {
    const input = makeResult("jira", {
      status: "success",
      action: "jql_search",
      data: { issues: [] },
    });
    expect(applyMermaid(input)).toBe(input);
  });
});

describe("applyMermaid — confluence", () => {
  it("attaches a page-hierarchy diagram for cql_search", () => {
    const out = applyMermaid(
      makeResult("confluence", {
        status: "success",
        action: "cql_search",
        data: {
          pages: [
            { title: "Page 1", space_key: "DEV" },
            { title: "Page 2", space_key: "DEV" },
          ],
        },
      }),
    );
    const env = out.envelope as Record<string, unknown>;
    expect(env["mermaid"]).toMatchObject({
      type: "graph TB",
      title: "Page Hierarchy",
    });
  });
});

describe("applyMermaid — notion", () => {
  it("attaches a search-hierarchy diagram for search", () => {
    const out = applyMermaid(
      makeResult("notion", {
        status: "success",
        action: "search",
        data: {
          results: [{ id: "abcd1234", object_type: "page" }],
        },
      }),
    );
    const env = out.envelope as Record<string, unknown>;
    expect(env["mermaid"]).toMatchObject({
      type: "graph TB",
      title: "Notion Search Hierarchy",
    });
  });
});

describe("applyMermaid — github", () => {
  it("attaches a dependency graph for package.json content", () => {
    const out = applyMermaid(
      makeResult("github", {
        status: "success",
        action: "get_file",
        data: {
          path: "package.json",
          content: JSON.stringify({
            dependencies: { vitest: "^3" },
            devDependencies: { typescript: "^5" },
          }),
        },
      }),
    );
    const env = out.envelope as Record<string, unknown>;
    expect(env["mermaid"]).toMatchObject({
      type: "graph LR",
      title: "Dependency Graph",
    });
    const code = (env["mermaid"] as Record<string, unknown>)["code"] as string;
    expect(code).toContain("vitest");
    expect(code).toContain("typescript");
  });

  it("skips when path is unknown extension", () => {
    const input = makeResult("github", {
      status: "success",
      action: "get_file",
      data: { path: "README.md", content: "# hi" },
    });
    expect(applyMermaid(input)).toBe(input);
  });
});

describe("applyMermaid — db", () => {
  it("attaches an erDiagram for status=ok schema results", () => {
    const out = applyMermaid(
      makeResult("db", {
        status: "ok",
        tables: [
          {
            name: "users",
            columns: [
              { name: "id", data_type: "int", is_primary_key: true },
              { name: "email", data_type: "text" },
            ],
          },
        ],
      }),
    );
    const env = out.envelope as Record<string, unknown>;
    expect(env["mermaid"]).toMatchObject({
      type: "erDiagram",
      title: "Database Schema",
    });
    const code = (env["mermaid"] as Record<string, unknown>)["code"] as string;
    expect(code).toContain("users");
    expect(code).toContain("id PK");
  });

  it("skips when tables array is empty", () => {
    const input = makeResult("db", { status: "ok", tables: [] });
    expect(applyMermaid(input)).toBe(input);
  });

  it("skips when status is not ok", () => {
    const input = makeResult("db", {
      status: "denied",
      tables: [{ name: "users", columns: [] }],
    });
    expect(applyMermaid(input)).toBe(input);
  });
});

describe("SUPPORTED_CONNECTORS", () => {
  it("includes all 7 wiki source/database connector short names", () => {
    expect(new Set(SUPPORTED_CONNECTORS)).toEqual(
      new Set(["aws", "gcp", "jira", "confluence", "notion", "github", "db"]),
    );
  });
});
