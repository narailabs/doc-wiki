/**
 * Tests for mermaid_format.ts — the shared agent Mermaid envelope helpers.
 */
import { describe, expect, it } from "vitest";

import {
  formatErDiagram,
  formatGraph,
  formatPhaseFlow,
  sanitizeLabel,
  sanitizeNodeId,
  type ClassDef,
  type MermaidBlock,
  type PhaseEdge,
  type PhaseNode,
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

describe("formatPhaseFlow", () => {
  it("emits the flowchart TD header and quoted-bracket rectangles", () => {
    const nodes: PhaseNode[] = [
      { id: "p1", label: "Phase 1: Detect" },
      { id: "p2", label: "Phase 2: Discover" },
    ];
    const edges: PhaseEdge[] = [{ from: "p1", to: "p2" }];
    const block = formatPhaseFlow("pipeline", nodes, edges);
    expect(block.type).toBe("flowchart TD");
    expect(block.title).toBe("pipeline");
    expect(block.code.startsWith("flowchart TD\n")).toBe(true);
    expect(block.code).toContain('p1["Phase 1: Detect"]');
    expect(block.code).toContain('p2["Phase 2: Discover"]');
    expect(block.code).toContain("p1 --> p2");
  });

  it("renders diamond shape for decision nodes", () => {
    const nodes: PhaseNode[] = [
      { id: "gate", label: "over budget?", shape: "diamond" },
      { id: "abort", label: "Abort" },
      { id: "go", label: "Continue" },
    ];
    const edges: PhaseEdge[] = [
      { from: "gate", to: "abort", label: "yes" },
      { from: "gate", to: "go", label: "no" },
    ];
    const block = formatPhaseFlow("decision", nodes, edges);
    expect(block.code).toContain('gate{"over budget?"}');
    expect(block.code).toContain("gate -- yes --> abort");
    expect(block.code).toContain("gate -- no --> go");
  });

  it("converts real newlines in labels to <br/>", () => {
    const block = formatPhaseFlow(
      "multi-line",
      [{ id: "n", label: "line one\nline two\nline three" }],
      [],
    );
    expect(block.code).toContain('n["line one<br/>line two<br/>line three"]');
    expect(block.code).not.toMatch(/line one\nline two/);
  });

  it("emits classDef blocks and groups class assignments by className", () => {
    const nodes: PhaseNode[] = [
      { id: "a", label: "A", className: "det" },
      { id: "b", label: "B", className: "llm" },
      { id: "c", label: "C", className: "det" },
      { id: "d", label: "D" },
    ];
    const classDefs: ClassDef[] = [
      { name: "det", fill: "#d4edda", stroke: "#155724" },
      { name: "llm", fill: "#fff3cd", stroke: "#856404" },
    ];
    const block = formatPhaseFlow("classes", nodes, [], classDefs);
    expect(block.code).toContain("classDef det fill:#d4edda,stroke:#155724");
    expect(block.code).toContain("classDef llm fill:#fff3cd,stroke:#856404");
    // a and c share className "det" — should be on one line, not two.
    expect(block.code).toContain("class a,c det");
    expect(block.code).toContain("class b llm");
    // d has no className → no class line for it.
    expect(block.code).not.toMatch(/class d /);
  });

  it("dedupes repeated node ids", () => {
    const nodes: PhaseNode[] = [
      { id: "p1", label: "First" },
      { id: "p1", label: "Duplicate" },
    ];
    const block = formatPhaseFlow("dedupe", nodes, []);
    const p1Lines = block.code.split("\n").filter((l) => l.includes('p1["'));
    expect(p1Lines.length).toBe(1);
    expect(block.code).toContain('p1["First"]');
  });

  it("escapes special characters inside labels", () => {
    const block = formatPhaseFlow(
      "escape",
      [{ id: "n", label: 'has "quote" and [bracket] and | pipe' }],
      [],
    );
    expect(block.code).toContain("&quot;quote&quot;");
    expect(block.code).toContain("&#91;bracket&#93;");
    expect(block.code).toContain("&#124; pipe");
  });

  it("omits the classDef section entirely when no classDefs are passed", () => {
    const block = formatPhaseFlow(
      "no-classes",
      [{ id: "n", label: "n" }],
      [],
    );
    expect(block.code).not.toContain("classDef");
    expect(block.code).not.toMatch(/^\s*class /m);
  });
});
