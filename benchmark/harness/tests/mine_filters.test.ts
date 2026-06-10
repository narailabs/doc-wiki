import { describe, expect, it } from "vitest";
import { checkEligibility, splitFiles } from "../mine_filters.js";

const PATTERNS = ["test/**", "**/*.test.ts"];

describe("splitFiles", () => {
  it("classifies by the repo's test_patterns", () => {
    const r = splitFiles(
      [
        { path: "test/core/run.spec.ts", additions: 10, deletions: 2 },
        { path: "packages/vitest/src/run.ts", additions: 20, deletions: 5 },
        { path: "packages/ui/render.test.ts", additions: 3, deletions: 0 },
      ],
      PATTERNS,
    );
    expect(r.test).toEqual(["test/core/run.spec.ts", "packages/ui/render.test.ts"]);
    expect(r.src).toEqual(["packages/vitest/src/run.ts"]);
  });
});

const BASE = {
  files: [
    { path: "test/x.test.ts", additions: 10, deletions: 0 },
    { path: "src/x.ts", additions: 30, deletions: 10 },
  ],
  authorIsBot: false,
  bodyLength: 400,
  mergedAt: "2025-09-01T00:00:00Z",
};
const CFG = { test_patterns: PATTERNS, ticket_after: "2025-06-01" };

describe("checkEligibility", () => {
  it("accepts a qualifying PR", () => {
    const r = checkEligibility(BASE, CFG);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.changed_lines).toBe(50);
  });
  it("rejects test-only PRs", () => {
    const r = checkEligibility({ ...BASE, files: [BASE.files[0]!] }, CFG);
    expect(r).toEqual({ ok: false, reason: "no-source-changes" });
  });
  it("rejects source-only PRs", () => {
    const r = checkEligibility({ ...BASE, files: [BASE.files[1]!] }, CFG);
    expect(r).toEqual({ ok: false, reason: "no-test-changes" });
  });
  it("rejects PRs over 400 changed lines", () => {
    const big = { ...BASE, files: [BASE.files[0]!, { path: "src/y.ts", additions: 500, deletions: 0 }] };
    expect(checkEligibility(big, CFG)).toEqual({ ok: false, reason: "too-large" });
  });
  it("rejects bots, thin bodies, and pre-floor merges", () => {
    expect(checkEligibility({ ...BASE, authorIsBot: true }, CFG)).toEqual({ ok: false, reason: "bot-author" });
    expect(checkEligibility({ ...BASE, bodyLength: 50 }, CFG)).toEqual({ ok: false, reason: "thin-body" });
    expect(checkEligibility({ ...BASE, mergedAt: "2025-01-01T00:00:00Z" }, CFG)).toEqual({ ok: false, reason: "before-ticket-after" });
  });
});

describe("checkEligibility boundaries", () => {
  it("rejects exactly 400 changed lines, accepts 399", () => {
    const at400 = { ...BASE, files: [
      { path: "test/x.test.ts", additions: 100, deletions: 0 },
      { path: "src/x.ts", additions: 300, deletions: 0 },
    ]};
    expect(checkEligibility(at400, CFG)).toEqual({ ok: false, reason: "too-large" });
    const at399 = { ...BASE, files: [
      { path: "test/x.test.ts", additions: 100, deletions: 0 },
      { path: "src/x.ts", additions: 299, deletions: 0 },
    ]};
    expect(checkEligibility(at399, CFG).ok).toBe(true);
  });

  it("accepts a merge exactly at the ticket_after floor (inclusive)", () => {
    const r = checkEligibility({ ...BASE, mergedAt: "2025-06-01T00:00:00Z" }, CFG);
    expect(r.ok).toBe(true);
  });
});

describe("runnable-test gates", () => {
  const RUN_CFG = {
    test_patterns: ["test/**", "**/*.test.ts"],
    run_patterns: ["test/**/*.test.ts"],
    exclude_test_paths: ["test/browser/**"],
    ticket_after: "2025-06-01",
  };

  it("separates runnable tests from support files and returns run_files", () => {
    const r = checkEligibility({ ...BASE, files: [
      { path: "test/e2e/fixtures/x/vitest.config.ts", additions: 5, deletions: 0 },
      { path: "test/e2e/test/feature.test.ts", additions: 10, deletions: 0 },
      { path: "src/x.ts", additions: 20, deletions: 0 },
    ]}, RUN_CFG);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.run_files).toEqual(["test/e2e/test/feature.test.ts"]);
      expect(r.test_files).toContain("test/e2e/fixtures/x/vitest.config.ts");
    }
  });

  it("rejects tickets whose test-side changes have no runnable entry point", () => {
    const r = checkEligibility({ ...BASE, files: [
      { path: "test/test-utils/index.ts", additions: 5, deletions: 0 },
      { path: "src/x.ts", additions: 20, deletions: 0 },
    ]}, RUN_CFG);
    expect(r).toEqual({ ok: false, reason: "no-runnable-tests" });
  });

  it("rejects tickets whose runnable tests live under excluded paths", () => {
    const r = checkEligibility({ ...BASE, files: [
      { path: "test/browser/specs/locator.test.ts", additions: 10, deletions: 0 },
      { path: "src/x.ts", additions: 20, deletions: 0 },
    ]}, RUN_CFG);
    expect(r).toEqual({ ok: false, reason: "excluded-test-paths" });
  });

  it("defaults run_patterns to test_patterns (legacy behavior preserved)", () => {
    const r = checkEligibility(BASE, CFG);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.run_files).toEqual(r.test_files);
  });
});
