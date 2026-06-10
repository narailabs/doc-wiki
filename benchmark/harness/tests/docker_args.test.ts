import { describe, expect, it } from "vitest";
import { buildImageArgs, gradeRunArgs, sessionRunArgs } from "../docker_args.js";

const SPEC = {
  image: "docwiki-bench-vitest",
  name: "bench-vitest-17-wiki",
  outDir: "/abs/runs/vitest/17/wiki",
  bareDir: "/abs/cache/vitest.git",
  wikiDir: "/abs/wiki-cache/vitest/overlay",
  baseCommit: "bbbb0000",
  model: "claude-sonnet-4-6",
  maxTurns: 80,
  install: ["corepack enable", "pnpm install"],
  timeoutSec: 1800,
};

describe("docker argv builders", () => {
  it("session args mount bare ro, out rw, wiki ro; pass token by name only", () => {
    const args = sessionRunArgs(SPEC);
    expect(args[0]).toBe("run");
    expect(args).toContain("--cap-add=NET_ADMIN");
    expect(args).toContain("/abs/cache/vitest.git:/bare:ro");
    expect(args).toContain("/abs/runs/vitest/17/wiki:/out");
    expect(args).toContain("/abs/wiki-cache/vitest/overlay:/wiki:ro");
    expect(args).toContain("CLAUDE_CODE_OAUTH_TOKEN"); // name-only -e: value comes from harness env
    expect(args.join(" ")).not.toMatch(/sk-|oauth-token-value/i); // no secret material in argv
    expect(args[args.length - 2]).toBe(SPEC.image);
    expect(args[args.length - 1]).toBe("session");
  });

  it("baseline session has no /wiki mount", () => {
    const args = sessionRunArgs({ ...SPEC, wikiDir: undefined });
    expect(args.join(" ")).not.toContain(":/wiki:ro");
  });

  it("grade args end with the grade mode", () => {
    const args = gradeRunArgs({
      image: SPEC.image, outDir: SPEC.outDir, bareDir: SPEC.bareDir,
      baseCommit: "bbbb0000", fixCommit: "aaaa9999",
      testFiles: ["test/a.test.ts"], testCommand: "npx vitest run {test_files}", retries: 1,
    });
    expect(args[args.length - 1]).toBe("grade");
    expect(args).toContain("BENCH_TEST_FILES=test/a.test.ts");
  });

  it("build args pin the toolchain", () => {
    const args = buildImageArgs("docwiki-bench-vitest", "node:22", "benchmark/harness/docker");
    expect(args).toEqual([
      "build", "-t", "docwiki-bench-vitest", "--build-arg", "TOOLCHAIN=node:22", "benchmark/harness/docker",
    ]);
  });

  it("session args include --name with the container name as adjacent elements", () => {
    const args = sessionRunArgs(SPEC);
    const i = args.indexOf("--name");
    expect(i).toBeGreaterThan(-1);
    expect(args[i + 1]).toBe("bench-vitest-17-wiki");
  });

  it("session args include --stop-timeout 10 as adjacent elements", () => {
    const args = sessionRunArgs(SPEC);
    const i = args.indexOf("--stop-timeout");
    expect(i).toBeGreaterThan(-1);
    expect(args[i + 1]).toBe("10");
  });

  it("grade args never pass the OAuth token (grading needs no token)", () => {
    const args = gradeRunArgs({
      image: SPEC.image, outDir: SPEC.outDir, bareDir: SPEC.bareDir,
      baseCommit: "bbbb0000", fixCommit: "aaaa9999",
      testFiles: ["test/a.test.ts"], testCommand: "npx vitest run {test_files}", retries: 1,
    });
    expect(args).not.toContain("CLAUDE_CODE_OAUTH_TOKEN");
    expect(args.join(" ")).not.toContain("CLAUDE_CODE_OAUTH_TOKEN");
  });

  it("paths with spaces survive as single array elements", () => {
    const args = sessionRunArgs({ ...SPEC, bareDir: "/a b/c.git", outDir: "/o ut/dir" });
    expect(args).toContain("/a b/c.git:/bare:ro");
    expect(args).toContain("/o ut/dir:/out");
  });
});

describe("gradeRunArgs run files", () => {
  it("emits BENCH_RUN_FILES (defaulting to testFiles when absent)", () => {
    const base = {
      image: "img", outDir: "/o", bareDir: "/b", baseCommit: "x", fixCommit: "y",
      testFiles: ["test/a.test.ts", "test/helper.ts"], testCommand: "t {test_files}", retries: 0,
    };
    expect(gradeRunArgs({ ...base, runFiles: ["test/a.test.ts"] })).toContain("BENCH_RUN_FILES=test/a.test.ts");
    expect(gradeRunArgs(base)).toContain("BENCH_RUN_FILES=test/a.test.ts test/helper.ts");
  });
});
