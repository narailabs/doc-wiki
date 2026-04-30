/**
 * Tests for mermaid_format.ts — the shared agent Mermaid envelope helpers.
 */
import { describe, expect, it } from "vitest";

import {
  formatErDiagram,
  formatGraph,
  sanitizeLabel,
  sanitizeNodeId,
  type MermaidBlock,
} from "../mermaid_format.js";

describe("sanitizeLabel", () => {
  it("escapes characters Mermaid treats specially inside labels", () => {
    expect(sanitizeLabel('Hello "world" [1] | &')).toBe(
      "Hello &quot;world&quot; &#91;1&#93; &#124; &amp;",
    );
  });

  it("collapses newlines to a single space", () => {
    expect(sanitizeLabel("a\n\nb\r\nc")).toBe("a b c");
  });

  it("trims leading/trailing whitespace", () => {
    expect(sanitizeLabel("   x   ")).toBe("x");
  });
});

describe("sanitizeNodeId", () => {
  it("replaces unsafe chars with underscores and collapses runs", () => {
    expect(sanitizeNodeId("a.b-c d/e")).toBe("a_b_c_d_e");
  });
  it("prefixes leading digits with underscore", () => {
    expect(sanitizeNodeId("123abc")).toBe("_123abc");
  });
  it("returns `_` for empty or all-special input", () => {
    expect(sanitizeNodeId("")).toBe("_");
    expect(sanitizeNodeId("---")).toBe("_");
  });
});

describe("formatGraph", () => {
  it("produces a valid graph TB envelope", () => {
    const block: MermaidBlock = formatGraph(
      "TB",
      "Infra Topology",
      [
        { id: "vpc-1", label: "VPC 1" },
        { id: "lambda-hello", label: "hello()" },
      ],
      [{ from: "vpc-1", to: "lambda-hello", label: "contains" }],
    );
    expect(block.type).toBe("graph TB");
    expect(block.title).toBe("Infra Topology");
    expect(block.code).toContain("graph TB");
    expect(block.code).toContain("vpc_1");
    expect(block.code).toContain("lambda_hello");
    expect(block.code).toContain('-->|contains|');
  });

  it("omits the edge label when not provided", () => {
    const block = formatGraph(
      "LR",
      "Deps",
      [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
      ],
      [{ from: "a", to: "b" }],
    );
    expect(block.code).toContain("a --> b");
    expect(block.code).not.toMatch(/-->\|/);
  });

  it("dedupes repeated nodes", () => {
    const block = formatGraph(
      "TB",
      "T",
      [
        { id: "x", label: "X" },
        { id: "x", label: "X'" },
      ],
      [],
    );
    const xLines = block.code.split("\n").filter((l) => l.includes('x["'));
    expect(xLines.length).toBe(1);
  });
});

describe("formatErDiagram", () => {
  it("emits table blocks and relationships", () => {
    const block = formatErDiagram(
      "UserService",
      [
        {
          name: "users",
          columns: [
            { name: "id", type: "bigint", key: "PK" },
            { name: "email", type: "varchar" },
          ],
        },
        {
          name: "orders",
          columns: [
            { name: "id", type: "bigint", key: "PK" },
            { name: "user_id", type: "bigint", key: "FK" },
          ],
        },
      ],
      [
        {
          from: "users",
          to: "orders",
          cardinality: "||--o{",
          label: "places",
        },
      ],
    );
    expect(block.type).toBe("erDiagram");
    expect(block.code).toContain("erDiagram");
    expect(block.code).toContain("users {");
    expect(block.code).toContain("bigint id PK");
    expect(block.code).toContain("bigint user_id FK");
    expect(block.code).toMatch(/users \|\|--o\{ orders :/);
  });

  it("handles tables with no columns and no relationships", () => {
    const block = formatErDiagram("Empty", [], []);
    expect(block.code).toBe("erDiagram");
  });
});
