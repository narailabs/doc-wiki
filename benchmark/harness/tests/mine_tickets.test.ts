import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Runner } from "../exec.js";
import { mineGithub } from "../mine_tickets.js";

const fx = (name: string): string =>
  readFileSync(join(import.meta.dirname, "fixtures", name), "utf8");

const fakeGh: Runner = async (cmd, args) => {
  expect(cmd).toBe("gh");
  const joined = args.join(" ");
  if (joined.includes("pr list")) return { code: 0, stdout: fx("gh_pr_list.json"), stderr: "" };
  if (joined.includes("pr view 42")) return { code: 0, stdout: fx("gh_pr_view_42.json"), stderr: "" };
  if (joined.includes("issues/17")) return { code: 0, stdout: fx("gh_issue_17.json"), stderr: "" };
  if (joined.includes("commits/aaaa")) return { code: 0, stdout: fx("gh_commit.json"), stderr: "" };
  return { code: 1, stdout: "", stderr: `unexpected: ${joined}` };
};

const CFG = {
  id: "demo", github: "acme/demo", clone_url: "x", language: "ts",
  ticket_source: "github" as const, install: [], test_command: "t {test_files}",
  test_patterns: ["test/**"], test_retries: 0, ticket_after: "2025-06-01",
  wiki_commit: "", toolchain: [], services: [],
};

describe("mineGithub", () => {
  it("produces a sanitized, eligible ticket record", async () => {
    const out = await mineGithub(CFG, { target: 10, limit: 200, runner: fakeGh });
    expect(out.tickets).toHaveLength(1);
    const t = out.tickets[0]!;
    expect(t).toMatchObject({
      issue: 17,
      fix_pr: 42,
      base_commit: "bbbb111122223333444455556666777788880000",
      fix_commit: "aaaa111122223333444455556666777788889999",
      test_files: ["test/config.test.ts"],
      src_files: ["src/config.ts"],
      changed_lines: 22,
    });
    expect(t.body_sanitized.length).toBeGreaterThan(0);
    expect(out.schema_version).toBe(1);
  });
});
