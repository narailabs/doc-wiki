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

  it("strips uppercase/mixed-case commit SHAs", () => {
    const r = sanitizeIssueBody("Introduced in DEADBEEF1234567", 50);
    expect(r.text).not.toContain("DEADBEEF1234567");
    expect(r.redactions).toContain("DEADBEEF1234567");
  });

  it("strips cross-repo refs >= the issue number, keeps earlier ones", () => {
    const r = sanitizeIssueBody("Tracked in acme/demo#205.", 200);
    expect(r.text).not.toContain("demo#205");
    expect(r.redactions).toContain("acme/demo#205");

    const kept = sanitizeIssueBody("Tracked in acme/demo#100.", 200);
    expect(kept.text).toContain("acme/demo#100");
    expect(kept.redactions).toEqual([]);
  });

  it("strips GH-N refs >= the issue number", () => {
    const r = sanitizeIssueBody("See GH-205", 200);
    expect(r.text).toContain("GH-[ref-removed]");
    expect(r.text).not.toContain("GH-205");
    expect(r.redactions).toContain("GH-205");
  });

  it("strips http (non-https) github URLs", () => {
    const r = sanitizeIssueBody("See http://github.com/acme/demo/pull/123", 50);
    expect(r.text).not.toContain("pull/123");
    expect(r.redactions).toContain("http://github.com/acme/demo/pull/123");
  });

  it("preserves the closing paren of markdown links", () => {
    const r = sanitizeIssueBody(
      "Apply [this patch](https://github.com/acme/demo/pull/205) to resolve.",
      50,
    );
    expect(r.text).toContain("[this patch]([link-removed]) to resolve.");
  });

  it("leaves pure-decimal identifiers like JIRA keys alone", () => {
    const r = sanitizeIssueBody("Duplicate of JIRA-1234567.", 50);
    expect(r.text).toBe("Duplicate of JIRA-1234567.");
    expect(r.redactions).toEqual([]);
  });
});
