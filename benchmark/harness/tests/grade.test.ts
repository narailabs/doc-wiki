import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { decideGrade, gradeRunLocal } from "../grade.js";

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
});
