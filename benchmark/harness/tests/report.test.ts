import { describe, expect, it } from "vitest";
import { renderResults } from "../report.js";
import type { BenchState, TicketRecord } from "../types.js";

const tickets = [
  { issue: 1, title: "bug one", merged_at: "2025-09-01T00:00:00Z" },
  { issue: 2, title: "bug two", merged_at: "2025-10-01T00:00:00Z" },
] as TicketRecord[];

const state: BenchState = {
  schema_version: 1,
  repo: "demo",
  runs: {
    "1:baseline": { status: "failed", cost_usd: 0.4, detail: "tests-failed" },
    "1:wiki": { status: "passed", cost_usd: 0.6, detail: "tests-passed" },
    "2:baseline": { status: "failed", cost_usd: 0.5, detail: "apply-failed" },
    "2:wiki": { status: "pending" },
  },
};

describe("renderResults", () => {
  it("renders pass rates over graded runs and totals cost", () => {
    const md = renderResults("demo", tickets, state);
    expect(md).toContain("| baseline | 0/2 (0%) |");
    expect(md).toContain("| wiki | 1/1 (100%) |");
    expect(md).toContain("$1.50"); // 0.4+0.6+0.5
    expect(md).toContain("bug one");
    expect(md).toContain("⏳"); // pending wiki run for ticket 2
  });

  it("marks retry-rescued passes distinctly", () => {
    const flaky: BenchState = {
      schema_version: 1, repo: "demo",
      runs: { "1:wiki": { status: "passed", detail: "tests-passed-on-retry" } },
    };
    const md = renderResults("demo", [tickets[0]!], flaky);
    expect(md).toContain("✅ (retry)");
  });

  it("escapes pipe characters in ticket titles", () => {
    const pipedTickets = [
      { issue: 3, title: "feat|fix: some title", merged_at: "2025-11-01T00:00:00Z" },
    ] as TicketRecord[];
    const pipeState: BenchState = {
      schema_version: 1,
      repo: "demo",
      runs: { "3:baseline": { status: "passed", detail: "tests-passed" } },
    };
    const md = renderResults("demo", pipedTickets, pipeState);
    expect(md).toContain("feat\\|fix: some title");
    // Should not add extra table columns
    const tableRow = md.split("\n").find((l) => l.includes("feat"));
    expect(tableRow?.split("|").length).toBeLessThanOrEqual(7); // | #3 title | date | baseline | wiki |
  });
});
