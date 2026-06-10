import { describe, expect, it } from "vitest";
import { sanitizeIssueBody } from "../sanitize.js";

describe("sanitizeIssueBody", () => {
  it("strips cross-references >= the issue number, keeps earlier ones", () => {
    const r = sanitizeIssueBody("Same as #100. Fixed properly in #205 maybe.", 200);
    expect(r.text).toContain("#100");
    expect(r.text).not.toContain("#205");
    expect(r.redactions).toContain("#205");
  });

  it("strips github pull/commit URLs", () => {
    const r = sanitizeIssueBody("See https://github.com/acme/demo/pull/123 for the fix", 50);
    expect(r.text).not.toContain("pull/123");
  });

  it("strips bare commit SHAs", () => {
    const r = sanitizeIssueBody("broken since deadbeefcafe1234", 50);
    expect(r.text).not.toContain("deadbeefcafe1234");
  });

  it("strips whole lines saying fixed-by/closed-by", () => {
    const r = sanitizeIssueBody("Repro steps here.\nFixed by the patch in the linked PR.\nMore context.", 50);
    expect(r.text).toContain("Repro steps");
    expect(r.text).toContain("More context");
    expect(r.text).not.toMatch(/Fixed by/i);
  });

  it("returns empty redactions for a clean body", () => {
    const r = sanitizeIssueBody("Just a plain bug report.", 10);
    expect(r.redactions).toEqual([]);
    expect(r.text).toBe("Just a plain bug report.");
  });
});
