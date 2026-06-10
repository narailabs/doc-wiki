import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { realRunner } from "../exec.js";
import { calibrateAll, decideGrade, gradeRunLocal } from "../grade.js";
import type { RepoConfig, TicketsFile } from "../types.js";

/** Build a tiny repo: base commit has a bug + no test; fix commit fixes it and adds a test. */
function fixtureRepo(): { bare: string; base: string; fix: string } {
  const src = mkdtempSync(join(tmpdir(), "benchfix-src-"));
  const git = (...a: string[]): string => execFileSync("git", a, { cwd: src, encoding: "utf8" }).trim();
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@t"); git("config", "user.name", "t");
  writeFileSync(join(src, "add.js"), "module.exports = (a, b) => a - b; // bug\n");
  git("add", "add.js"); git("commit", "-qm", "base");
  const base = git("rev-parse", "HEAD");
  writeFileSync(join(src, "add.js"), "module.exports = (a, b) => a + b;\n");
  mkdirSync(join(src, "test"), { recursive: true });
  writeFileSync(join(src, "test", "add.test.js"),
    "const add = require('../add.js');\nif (add(2, 3) !== 5) { console.error('FAIL'); process.exit(1); }\n");
  git("add", "-A"); git("commit", "-qm", "fix");
  const fix = git("rev-parse", "HEAD");
  const bare = mkdtempSync(join(tmpdir(), "benchfix-bare-")) + "/repo.git";
  execFileSync("git", ["clone", "-q", "--bare", src, bare]);
  return { bare, base, fix };
}

const TEST_CMD = "node {test_files}";
const TEST_FILES = ["test/add.test.js"];

describe("decideGrade", () => {
  it("maps grade.sh exit codes", () => {
    expect(decideGrade(0)).toEqual({ outcome: "passed", detail: "tests-passed" });
    expect(decideGrade(5)).toEqual({ outcome: "passed", detail: "tests-passed-on-retry" });
    expect(decideGrade(10)).toEqual({ outcome: "failed", detail: "apply-failed" });
    expect(decideGrade(20)).toEqual({ outcome: "failed", detail: "tests-failed" });
    expect(() => decideGrade(64)).toThrow(/setup/);
  });
});

describe("gradeRunLocal (real git, no docker)", () => {
  // Two sequential gradeRunLocal calls + fixture setup; needs more than default 5s
  it("passes a correct agent diff and fails an empty one", async () => {
    const { bare, base, fix } = fixtureRepo();

    // "Agent diff": the real fix to add.js (source only, no tests).
    const outDir = mkdtempSync(join(tmpdir(), "benchout-"));
    const goodDiff = execFileSync("git", ["diff", "--binary", base, fix, "--", "add.js"], { cwd: bare, encoding: "utf8" });
    writeFileSync(join(outDir, "diff.patch"), goodDiff);
    const good = await gradeRunLocal({ bareDir: bare, outDir, baseCommit: base, fixCommit: fix, testFiles: TEST_FILES, testCommand: TEST_CMD, retries: 0 });
    expect(good).toEqual({ outcome: "passed", detail: "tests-passed" });

    const outDir2 = mkdtempSync(join(tmpdir(), "benchout-"));
    writeFileSync(join(outDir2, "diff.patch"), "");
    const empty = await gradeRunLocal({ bareDir: bare, outDir: outDir2, baseCommit: base, fixCommit: fix, testFiles: TEST_FILES, testCommand: TEST_CMD, retries: 0 });
    expect(empty).toEqual({ outcome: "failed", detail: "tests-failed" });
  }, 15_000);

  it("calibrate-base returns passed when tests fail on base (calibration ok)", async () => {
    const { bare, base, fix } = fixtureRepo();
    const outDir = mkdtempSync(join(tmpdir(), "benchout-"));
    // calibrate-base: checkout base + overlay test files from fix, run tests → should FAIL (bug present) → exit 0
    const result = await gradeRunLocal({
      bareDir: bare, outDir, baseCommit: base, fixCommit: fix,
      testFiles: TEST_FILES, testCommand: TEST_CMD, retries: 0,
      mode: "calibrate-base",
    });
    expect(result).toEqual({ outcome: "passed", detail: "tests-passed" });
  }, 10_000);

  it("calibrate-fix returns passed when tests pass on fix commit", async () => {
    const { bare, base, fix } = fixtureRepo();
    const outDir = mkdtempSync(join(tmpdir(), "benchout-"));
    // calibrate-fix: checkout fix entirely → tests should pass → exit 0
    const result = await gradeRunLocal({
      bareDir: bare, outDir, baseCommit: base, fixCommit: fix,
      testFiles: TEST_FILES, testCommand: TEST_CMD, retries: 0,
      mode: "calibrate-fix",
    });
    expect(result).toEqual({ outcome: "passed", detail: "tests-passed" });
  }, 10_000);

  it("returns apply-failed for a corrupted (conflicting) diff", async () => {
    const { bare, base, fix } = fixtureRepo();
    const outDir = mkdtempSync(join(tmpdir(), "benchout-"));
    const goodDiff = execFileSync("git", ["diff", "--binary", base, fix, "--", "add.js"], { cwd: bare, encoding: "utf8" });
    // Corrupt a context line so git apply rejects it
    const corruptDiff = goodDiff.replace("module.exports = (a, b) => a - b; // bug", "module.exports = (a, b) => a * b; // wrong context");
    writeFileSync(join(outDir, "diff.patch"), corruptDiff);
    const result = await gradeRunLocal({
      bareDir: bare, outDir, baseCommit: base, fixCommit: fix,
      testFiles: TEST_FILES, testCommand: TEST_CMD, retries: 0,
    });
    expect(result).toEqual({ outcome: "failed", detail: "apply-failed" });
  }, 10_000);

  // Flaky test command: fails on first invocation, passes on the second.
  // Both run_tests invocations share one clone, so a marker file in the workdir works.
  const FLAKY_CMD =
    "node -e 'const fs=require(\"fs\"); if (fs.existsSync(\"m\")) process.exit(0); fs.writeFileSync(\"m\",\"\"); process.exit(1)'";

  it("flaky tests with retries:0 fail", async () => {
    const { bare, base, fix } = fixtureRepo();
    const outDir = mkdtempSync(join(tmpdir(), "benchout-"));
    const goodDiff = execFileSync("git", ["diff", "--binary", base, fix, "--", "add.js"], { cwd: bare, encoding: "utf8" });
    writeFileSync(join(outDir, "diff.patch"), goodDiff);
    const result = await gradeRunLocal({
      bareDir: bare, outDir, baseCommit: base, fixCommit: fix,
      testFiles: TEST_FILES, testCommand: FLAKY_CMD, retries: 0,
    });
    expect(result).toEqual({ outcome: "failed", detail: "tests-failed" });
  }, 10_000);

  it("flaky tests with retries:1 pass on retry, distinguishably", async () => {
    const { bare, base, fix } = fixtureRepo();
    const outDir = mkdtempSync(join(tmpdir(), "benchout-"));
    const goodDiff = execFileSync("git", ["diff", "--binary", base, fix, "--", "add.js"], { cwd: bare, encoding: "utf8" });
    writeFileSync(join(outDir, "diff.patch"), goodDiff);
    const result = await gradeRunLocal({
      bareDir: bare, outDir, baseCommit: base, fixCommit: fix,
      testFiles: TEST_FILES, testCommand: FLAKY_CMD, retries: 1,
    });
    expect(result).toEqual({ outcome: "passed", detail: "tests-passed-on-retry" });
  }, 10_000);
});

describe("calibrateAll (real git, no docker)", () => {
  it("does not exclude a ticket whose test file is NEW at the fix commit", async () => {
    // fixtureRepo is exactly this shape: test/add.test.js does not exist at base.
    const { bare, base, fix } = fixtureRepo();
    const cfg: RepoConfig = {
      id: "demo", github: "o/r", clone_url: "", language: "js", ticket_source: "github",
      install: [], test_command: TEST_CMD, test_patterns: ["test/**"], test_retries: 0,
      ticket_after: "2026-01-01", wiki_commit: "", toolchain: [], services: [],
    };
    const tickets: TicketsFile = {
      schema_version: 1, repo: "demo", mined_at: "2026-06-10T00:00:00Z",
      tickets: [{
        issue: 1, issue_url: "u", title: "t", body: "b", body_sanitized: "b",
        fix_pr: 2, fix_pr_url: "u", base_commit: base, fix_commit: fix,
        test_files: TEST_FILES, src_files: ["add.js"], changed_lines: 1,
        merged_at: "2026-06-01T00:00:00Z",
      }],
    };
    const dir = mkdtempSync(join(tmpdir(), "benchtix-"));
    const ticketsPath = join(dir, "demo.json");
    writeFileSync(ticketsPath, JSON.stringify(tickets));

    await calibrateAll(cfg, ticketsPath, bare, { local: true, image: "x", runner: realRunner });

    const after = JSON.parse(readFileSync(ticketsPath, "utf8")) as TicketsFile;
    const t = after.tickets[0];
    expect(t?.excluded).toBeUndefined();
    expect(t?.calibration).toEqual({
      paths_stable: true, tests_fail_on_base: true, tests_pass_on_fix: true,
    });
  }, 20_000);
});

describe("run_files vs test_files separation", () => {
  it("executes only the runnable subset while support files are still overlaid", async () => {
    const src = mkdtempSync(join(tmpdir(), "benchrun-src-"));
    const git = (...a: string[]): string => execFileSync("git", a, { cwd: src, encoding: "utf8" }).trim();
    git("init", "-q", "-b", "main");
    git("config", "user.email", "t@t"); git("config", "user.name", "t");
    writeFileSync(join(src, "calc.js"), "module.exports = (a, b) => a - b;\n");
    git("add", "-A"); git("commit", "-qm", "base");
    const base = git("rev-parse", "HEAD");
    writeFileSync(join(src, "calc.js"), "module.exports = (a, b) => a + b;\n");
    mkdirSync(join(src, "test"), { recursive: true });
    // Support file: crashes if ever executed as a test entry point; required by the real test.
    writeFileSync(join(src, "test", "helper.js"),
      "if (require.main === module) process.exit(1);\nmodule.exports = { expectFive: (v) => { if (v !== 5) process.exit(1); } };\n");
    writeFileSync(join(src, "test", "calc.test.js"),
      "const { expectFive } = require('./helper.js');\nconst c = require('../calc.js');\nexpectFive(c(2, 3));\n");
    git("add", "-A"); git("commit", "-qm", "fix");
    const fix = git("rev-parse", "HEAD");
    const bare = `${mkdtempSync(join(tmpdir(), "benchrun-bare-"))}/repo.git`;
    execFileSync("git", ["clone", "-q", "--bare", src, bare]);

    const outDir = mkdtempSync(join(tmpdir(), "benchrun-out-"));
    const goodDiff = execFileSync("git", ["diff", "--binary", base, fix, "--", "calc.js"], { cwd: bare, encoding: "utf8" });
    writeFileSync(join(outDir, "diff.patch"), goodDiff);
    const both = { bareDir: bare, outDir, baseCommit: base, fixCommit: fix, testCommand: String.raw`for f in {test_files}; do node "$f" || exit 1; done`, retries: 0 };

    // With run_files scoped to the real test: passes (helper overlaid but not executed).
    const scoped = await gradeRunLocal({ ...both, testFiles: ["test/calc.test.js", "test/helper.js"], runFiles: ["test/calc.test.js"] });
    expect(scoped).toEqual({ outcome: "passed", detail: "tests-passed" });

    // Legacy fallback (no runFiles): the helper is executed as an entry point and fails the run.
    const legacy = await gradeRunLocal({ ...both, testFiles: ["test/calc.test.js", "test/helper.js"] });
    expect(legacy).toEqual({ outcome: "failed", detail: "tests-failed" });
  });
});
