import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Runner } from "../exec.js";
import { mineGithub } from "../mine_tickets.js";

const fx = (name: string): string =>
  readFileSync(join(import.meta.dirname, "fixtures", name), "utf8");

type Json = Record<string, unknown>;

const fxJson = <T>(name: string): T => JSON.parse(fx(name)) as T;

/** Build a fake gh Runner from a map of arg-substring -> JSON payload. First matching key wins. */
const makeGh = (routes: Record<string, unknown>): Runner => async (cmd, args) => {
  expect(cmd).toBe("gh");
  const joined = args.join(" ");
  for (const [needle, payload] of Object.entries(routes)) {
    if (joined.includes(needle)) return { code: 0, stdout: JSON.stringify(payload), stderr: "" };
  }
  return { code: 1, stdout: "", stderr: `unexpected: ${joined}` };
};

/** Happy-path routes derived from the canonical fixtures; tests override entries per-case. */
const baseRoutes = (): Record<string, unknown> => ({
  "pr list": fxJson<Json[]>("gh_pr_list.json"),
  "pr view 42": fxJson<Json>("gh_pr_view_42.json"),
  "issues/17": fxJson<Json>("gh_issue_17.json"),
  "commits/aaaa": fxJson<Json>("gh_commit.json"),
});

const CFG = {
  id: "demo", github: "acme/demo", clone_url: "x", language: "ts",
  ticket_source: "github" as const, install: [], test_command: "t {test_files}",
  test_patterns: ["test/**"], test_retries: 0, ticket_after: "2025-06-01",
  wiki_commit: "", toolchain: [], services: [],
};

const mine = (routes: Record<string, unknown>, target = 10) =>
  mineGithub(CFG, { target, limit: 200, runner: makeGh(routes) });

describe("mineGithub", () => {
  it("produces a sanitized, eligible ticket record", async () => {
    const out = await mine(baseRoutes());
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
      merge_parents: 1,
    });
    expect(t.body_sanitized.length).toBeGreaterThan(0);
    expect(out.schema_version).toBe(1);
  });

  it("skips PRs with no linked issue", async () => {
    const routes = baseRoutes();
    routes["pr view 42"] = { ...fxJson<Json>("gh_pr_view_42.json"), closingIssuesReferences: [] };
    const out = await mine(routes);
    expect(out.tickets).toHaveLength(0);
  });

  it("skips references that are actually PRs", async () => {
    const routes = baseRoutes();
    routes["issues/17"] = {
      ...fxJson<Json>("gh_issue_17.json"),
      pull_request: { url: "https://github.com/acme/demo/pulls/17" },
    };
    const out = await mine(routes);
    expect(out.tickets).toHaveLength(0);
  });

  it("skips ineligible PRs (no test-file changes)", async () => {
    const routes = baseRoutes();
    routes["pr view 42"] = {
      ...fxJson<Json>("gh_pr_view_42.json"),
      files: [{ path: "src/config.ts", additions: 8, deletions: 2 }],
    };
    const out = await mine(routes);
    expect(out.tickets).toHaveLength(0);
  });

  it("dedupes two PRs closing the same issue", async () => {
    const routes = baseRoutes();
    const entry42 = fxJson<Json[]>("gh_pr_list.json")[0]!;
    routes["pr list"] = [entry42, { ...entry42, number: 43, url: "https://github.com/acme/demo/pull/43" }];
    routes["pr view 43"] = {
      ...fxJson<Json>("gh_pr_view_42.json"),
      number: 43,
      url: "https://github.com/acme/demo/pull/43",
    };
    const out = await mine(routes);
    expect(out.tickets).toHaveLength(1);
    expect(out.tickets[0]!.fix_pr).toBe(42);
  });

  it("stops at the target ticket count", async () => {
    const routes = baseRoutes();
    const entry42 = fxJson<Json[]>("gh_pr_list.json")[0]!;
    routes["pr list"] = [entry42, { ...entry42, number: 43, url: "https://github.com/acme/demo/pull/43" }];
    routes["pr view 43"] = {
      ...fxJson<Json>("gh_pr_view_42.json"),
      number: 43,
      url: "https://github.com/acme/demo/pull/43",
      closingIssuesReferences: [{ number: 18 }],
    };
    routes["issues/18"] = {
      ...fxJson<Json>("gh_issue_17.json"),
      number: 18,
      html_url: "https://github.com/acme/demo/issues/18",
    };
    const out = await mine(routes, 1);
    expect(out.tickets).toHaveLength(1);
  });

  it("redacts forward references in the issue body", async () => {
    const routes = baseRoutes();
    const issue = fxJson<Json>("gh_issue_17.json");
    routes["issues/17"] = { ...issue, body: `${String(issue.body)} See #42 for details.` };
    const out = await mine(routes);
    expect(out.tickets).toHaveLength(1);
    const t = out.tickets[0]!;
    expect(t.body_sanitized).not.toBe(t.body);
    expect(t.body_sanitized).toContain("[ref-removed]");
  });
});
