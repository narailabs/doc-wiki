import { describe, expect, it } from "vitest";
import { validateWikiCommit, wikiSessionArgs } from "../build_wiki.js";

describe("validateWikiCommit", () => {
  it("requires wiki_commit to be set", () => {
    expect(() => validateWikiCommit("")).toThrow(/wiki_commit/);
    expect(() => validateWikiCommit("abc123")).not.toThrow();
  });
});

describe("wikiSessionArgs", () => {
  it("mounts the plugin and overlay dirs and disables the firewall stage", () => {
    const args = wikiSessionArgs({
      image: "docwiki-bench-vitest", bareDir: "/b", overlayDir: "/o", pluginDir: "/p",
      wikiCommit: "cccc", model: "claude-sonnet-4-6",
    });
    expect(args).toContain("/p:/plugin:ro");
    expect(args).toContain("/o:/out");
    expect(args).toContain("BENCH_SKIP_FIREWALL=1");
    expect(args).toContain("CLAUDE_CODE_OAUTH_TOKEN"); // name-only
    expect(args[args.length - 1]).toBe("wiki-build");
  });
});
