import { describe, expect, it } from "vitest";
import { checkWikiIsAncestor, validateWikiCommit, wikiSessionArgs } from "../build_wiki.js";
import type { Runner } from "../exec.js";

describe("validateWikiCommit", () => {
  it("requires wiki_commit to be set", () => {
    expect(() => validateWikiCommit("")).toThrow(/wiki_commit/);
    expect(() => validateWikiCommit("abc123")).not.toThrow();
  });
});

describe("checkWikiIsAncestor", () => {
  const ok: Runner = async () => ({ code: 0, stdout: "", stderr: "" });

  it("resolves when wiki_commit is an ancestor of every base commit", async () => {
    await expect(checkWikiIsAncestor(ok, "/bare", "cccc", ["aaaa", "bbbb"])).resolves.toBeUndefined();
  });

  it("throws a contamination-guard error naming the offending base commit", async () => {
    const failOnBbbb: Runner = async (_cmd, args) =>
      args[args.length - 1] === "bbbb"
        ? { code: 1, stdout: "", stderr: "" }
        : { code: 0, stdout: "", stderr: "" };
    await expect(checkWikiIsAncestor(failOnBbbb, "/bare", "cccc", ["aaaa", "bbbb"])).rejects.toThrow(
      /contamination guard.*bbbb/,
    );
  });
});

describe("wikiSessionArgs", () => {
  it("mounts the plugin and overlay dirs dirs", () => {
    const args = wikiSessionArgs({
      image: "docwiki-bench-vitest", bareDir: "/b", outDir: "/o", pluginDir: "/p",
      wikiCommit: "cccc", model: "claude-sonnet-4-6",
    });
    expect(args).toContain("/p:/plugin:ro");
    expect(args).toContain("/o:/out");
    expect(args).toContain("CLAUDE_CODE_OAUTH_TOKEN"); // name-only
    expect(args[args.length - 1]).toBe("wiki-build");
  });
});
