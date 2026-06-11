import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Runner } from "../exec.js";
import { main, mineGithub } from "../mine_tickets.js";

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

  it("tags issue-linked tickets with source 'issue'", async () => {
    const out = await mine(baseRoutes());
    expect(out.tickets).toHaveLength(1);
    expect(out.tickets[0]!.source).toBe("issue");
  });

  it("falls back to a PR-as-ticket when no issue is linked", async () => {
    const routes = baseRoutes();
    routes["pr view 42"] = fxJson<Json>("gh_pr_view_99_unlinked.json");
    const out = await mine(routes);
    expect(out.tickets).toHaveLength(1);
    const t = out.tickets[0]!;
    expect(t.source).toBe("pr");
    expect(t.issue).toBe(99); // PR number serves as the ticket id
    expect(t.fix_pr).toBe(99);
    expect(t.issue_url).toBe("https://github.com/acme/demo/pull/99");
    expect(t.base_commit).toBe("bbbb111122223333444455556666777788880000"); // PR's first parent
    expect(t.fix_commit).toBe("aaaa111122223333444455556666777788889999"); // PR merge commit
    expect(t.test_files).toEqual(["test/checkout.test.ts"]);
    expect(t.src_files).toEqual(["src/checkout.ts"]);
    // body_sanitized has the template boilerplate stripped:
    expect(t.body_sanitized).not.toContain("<!--");
    expect(t.body_sanitized).not.toContain("# Impact");
    expect(t.body_sanitized).not.toContain("[ ]");
    expect(t.body_sanitized).not.toContain("[x]");
    expect(t.body_sanitized).toContain("double-counts percentage discounts");
  });

  it("still filters PR-as-ticket fallbacks with no test changes", async () => {
    const routes = baseRoutes();
    routes["pr view 42"] = {
      ...fxJson<Json>("gh_pr_view_99_unlinked.json"),
      files: [{ path: "src/checkout.ts", additions: 9, deletions: 3 }],
    };
    const out = await mine(routes);
    expect(out.tickets).toHaveLength(0);
  });

  it("dedupes a PR-as-ticket so it is not double-emitted", async () => {
    const routes = baseRoutes();
    const list = fxJson<Json[]>("gh_pr_list.json");
    const entry42 = { ...(list[0] as Json), number: 99, url: "https://github.com/acme/demo/pull/99" };
    routes["pr list"] = [entry42, { ...entry42 }];
    routes["pr view 99"] = fxJson<Json>("gh_pr_view_99_unlinked.json");
    const out = await mineGithub(CFG, { target: 10, limit: 200, runner: makeGh(routes) });
    expect(out.tickets).toHaveLength(1);
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

describe("mineGithub hardening regressions", () => {
  it("skips a PR whose gh response is non-JSON and continues the walk", async () => {
    const prList = [
      { number: 42, url: "https://github.com/acme/demo/pull/42", mergedAt: "2025-09-01T12:00:00Z" },
      { number: 43, url: "https://github.com/acme/demo/pull/43", mergedAt: "2025-09-02T12:00:00Z" },
    ];
    const view43 = { ...fxJson<Json>("gh_pr_view_42.json"), number: 43, url: "https://github.com/acme/demo/pull/43" };
    const inner = makeGh({
      "pr list": prList,
      "pr view 43": view43,
      "issues/17": fxJson<Json>("gh_issue_17.json"),
      "commits/aaaa": fxJson<Json>("gh_commit.json"),
    });
    const runner: Runner = async (cmd, args) => {
      if (args.join(" ").includes("pr view 42")) return { code: 0, stdout: "WARNING: <html>not json</html>", stderr: "" };
      return inner(cmd, args);
    };
    const out = await mineGithub(CFG, { target: 10, limit: 200, runner });
    expect(out.tickets).toHaveLength(1);
    expect(out.tickets[0]!.fix_pr).toBe(43);
  });

  it("keeps multi-parent merges and records merge_parents", async () => {
    const commit = fxJson<{ sha: string; parents: Array<{ sha: string }> }>("gh_commit.json");
    const twoParent = { ...commit, parents: [...commit.parents, { sha: "cccc111122223333444455556666777788881111" }] };
    const out = await mine({ ...baseRoutes(), "commits/aaaa": twoParent });
    expect(out.tickets).toHaveLength(1);
    expect(out.tickets[0]).toMatchObject({
      merge_parents: 2,
      base_commit: "bbbb111122223333444455556666777788880000",
    });
  });

  it("main rejects non-positive/non-integer --target and --limit with exit 2", async () => {
    expect(await main(["--repo", "vitest", "--target", "abc"])).toBe(2);
    expect(await main(["--repo", "vitest", "--target", "0"])).toBe(2);
    expect(await main(["--repo", "vitest", "--limit", "2.5"])).toBe(2);
  });
});
