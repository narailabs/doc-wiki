import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { realRunner } from "../exec.js";
import { calibrateAll, decideGrade, gradeAll, gradeRunLocal } from "../grade.js";
import type { BenchState, RepoConfig, TicketsFile } from "../types.js";

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
      install: [], test_command: TEST_CMD, test_patterns: ["test/**"], run_patterns: ["test/**"],
      exclude_test_paths: [], test_retries: 0,
      ticket_after: "2026-01-01", wiki_commit: "", toolchain: [], services: [],
      container_env: {}, system_packages: [],
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

describe("calibrateAll sidecar routing (fake runner, no docker)", () => {
  const DB: import("../types.js").ServiceSpec = {
    name: "db",
    image: "postgres:15-alpine",
    env: { POSTGRES_PASSWORD: "x" },
  };

  function baseCfg(overrides: Partial<RepoConfig>): RepoConfig {
    return {
      id: "saleor", github: "o/r", clone_url: "", language: "py", ticket_source: "github",
      install: [], test_command: TEST_CMD, test_patterns: ["test/**"], run_patterns: ["test/**"],
      exclude_test_paths: [], test_retries: 0,
      ticket_after: "2026-01-01", wiki_commit: "", toolchain: [], services: [],
      container_env: {}, system_packages: [],
      ...overrides,
    };
  }

  function ticketsWith(): TicketsFile {
    return {
      schema_version: 1, repo: "saleor", mined_at: "2026-06-10T00:00:00Z",
      tickets: [{
        issue: 7, issue_url: "u", title: "t", body: "b", body_sanitized: "b",
        fix_pr: 2, fix_pr_url: "u", base_commit: "base123", fix_commit: "fix456",
        test_files: TEST_FILES, src_files: ["app.py"], changed_lines: 1,
        merged_at: "2026-06-01T00:00:00Z",
      }],
    };
  }

  /** Fake runner: git cat-file → exit 0 (paths stable); docker grade runs → exit 0 (calibration ok); everything else exit 0. */
  function recordingRunner(calls: { cmd: string; args: string[] }[]): import("../exec.js").Runner {
    return async (cmd, args) => {
      calls.push({ cmd, args: [...args] });
      return { code: 0, stdout: "", stderr: "" };
    };
  }

  it("HAS services: routes through container path with sidecars, modes, container_env, private-net flag", async () => {
    const cfg = baseCfg({
      services: [DB],
      container_env: { DATABASE_URL: "postgres://db:5432/saleor" },
    });
    const dir = mkdtempSync(join(tmpdir(), "benchcal-"));
    const ticketsPath = join(dir, "saleor.json");
    writeFileSync(ticketsPath, JSON.stringify(ticketsWith()));
    const calls: { cmd: string; args: string[] }[] = [];

    await calibrateAll(cfg, ticketsPath, "/bare.git", { local: false, image: "docwiki-bench-saleor", runner: recordingRunner(calls) });

    const dockerCalls = calls.filter((c) => c.cmd === "docker");
    const joined = dockerCalls.map((c) => c.args.join(" "));

    // No host bash grade.sh path was used.
    expect(calls.some((c) => c.cmd === "bash")).toBe(false);

    // Sidecars: network create + network rm observed.
    expect(joined.some((a) => a.startsWith("network create "))).toBe(true);
    expect(joined.some((a) => a.startsWith("network rm "))).toBe(true);

    // Two grade runs against the image, in calibrate-base then calibrate-fix mode.
    const gradeRuns = dockerCalls.filter((c) => c.args[0] === "run" && c.args[c.args.length - 1] === "grade");
    expect(gradeRuns).toHaveLength(2);
    expect(gradeRuns[0]?.args).toContain("docwiki-bench-saleor");
    expect(gradeRuns[0]?.args).toContain("BENCH_GRADE_MODE=calibrate-base");
    expect(gradeRuns[1]?.args).toContain("BENCH_GRADE_MODE=calibrate-fix");

    // Both grade runs join the sidecar network, carry container_env, and the private-net allow flag.
    for (const gr of gradeRuns) {
      expect(gr.args).toContain("--network");
      const net = gr.args[gr.args.indexOf("--network") + 1];
      expect(net).toMatch(/^bench-saleor-7-.*-net$/);
      expect(gr.args).toContain("DATABASE_URL=postgres://db:5432/saleor");
      expect(gr.args).toContain("BENCH_ALLOW_PRIVATE_NET=1");
    }

    // Calibration recorded as passing.
    const after = JSON.parse(readFileSync(ticketsPath, "utf8")) as TicketsFile;
    expect(after.tickets[0]?.excluded).toBeUndefined();
    expect(after.tickets[0]?.calibration).toEqual({
      paths_stable: true, tests_fail_on_base: true, tests_pass_on_fix: true,
    });
  });

  it("NO services: still uses host grade.sh, no docker run, no network", async () => {
    const cfg = baseCfg({ services: [] });
    const dir = mkdtempSync(join(tmpdir(), "benchcal-"));
    const ticketsPath = join(dir, "saleor.json");
    writeFileSync(ticketsPath, JSON.stringify(ticketsWith()));
    const calls: { cmd: string; args: string[] }[] = [];

    await calibrateAll(cfg, ticketsPath, "/bare.git", { local: true, image: "x", runner: recordingRunner(calls) });

    const bashCalls = calls.filter((c) => c.cmd === "bash");
    expect(bashCalls.length).toBeGreaterThan(0);
    expect(bashCalls.every((c) => c.args[0]?.endsWith("grade.sh"))).toBe(true);
    expect(calls.some((c) => c.cmd === "docker" && c.args[0] === "run")).toBe(false);
    expect(calls.some((c) => c.cmd === "docker" && c.args[0] === "network")).toBe(false);
  });

  it("HAS services: a startSidecars failure excludes the ticket as calibration-error, no crash", async () => {
    const cfg = baseCfg({ services: [DB] });
    const dir = mkdtempSync(join(tmpdir(), "benchcal-"));
    const ticketsPath = join(dir, "saleor.json");
    writeFileSync(ticketsPath, JSON.stringify(ticketsWith()));
    const calls: { cmd: string; args: string[] }[] = [];
    const runner: import("../exec.js").Runner = async (cmd, args) => {
      calls.push({ cmd, args: [...args] });
      if (cmd === "docker" && args[0] === "network" && args[1] === "create") {
        return { code: 1, stdout: "", stderr: "network create boom" };
      }
      return { code: 0, stdout: "", stderr: "" };
    };

    await expect(
      calibrateAll(cfg, ticketsPath, "/bare.git", { local: false, image: "img", runner }),
    ).resolves.toBeUndefined();

    const after = JSON.parse(readFileSync(ticketsPath, "utf8")) as TicketsFile;
    expect(after.tickets[0]?.excluded).toMatch(/calibration-error/);
    // teardown still ran (network rm) despite the create failure.
    expect(calls.some((c) => c.cmd === "docker" && c.args[0] === "network" && c.args[1] === "rm")).toBe(true);
  });
});

describe("gradeAll sidecar pre-clean (fake runner, no docker)", () => {
  const DB: import("../types.js").ServiceSpec = {
    name: "db",
    image: "postgres:15-alpine",
    env: { POSTGRES_PASSWORD: "x" },
  };

  function baseCfg(overrides: Partial<RepoConfig>): RepoConfig {
    return {
      id: "saleor", github: "o/r", clone_url: "", language: "py", ticket_source: "github",
      install: [], test_command: TEST_CMD, test_patterns: ["test/**"], run_patterns: ["test/**"],
      exclude_test_paths: [], test_retries: 0,
      ticket_after: "2026-01-01", wiki_commit: "", toolchain: [], services: [],
      container_env: {}, system_packages: [],
      ...overrides,
    };
  }

  function setupRuns(cfg: RepoConfig, issue: number, arm: string): { runsRoot: string; ticketsPath: string } {
    const root = mkdtempSync(join(tmpdir(), "benchgrade-"));
    const runsRoot = join(root, "runs");
    const outDir = join(runsRoot, cfg.id, String(issue), arm);
    mkdirSync(outDir, { recursive: true });
    const state: BenchState = {
      schema_version: 1, repo: cfg.id,
      runs: { [`${issue}:${arm}`]: { status: "ran" } },
    };
    mkdirSync(join(runsRoot, cfg.id), { recursive: true });
    writeFileSync(join(runsRoot, cfg.id, "state.json"), JSON.stringify(state));
    const tickets: TicketsFile = {
      schema_version: 1, repo: cfg.id, mined_at: "2026-06-10T00:00:00Z",
      tickets: [{
        issue, issue_url: "u", title: "t", body: "b", body_sanitized: "b",
        fix_pr: 2, fix_pr_url: "u", base_commit: "base123", fix_commit: "fix456",
        test_files: TEST_FILES, src_files: ["app.py"], changed_lines: 1,
        merged_at: "2026-06-01T00:00:00Z",
      }],
    };
    const ticketsPath = join(root, "saleor.json");
    writeFileSync(ticketsPath, JSON.stringify(tickets));
    return { runsRoot, ticketsPath };
  }

  it("pre-cleans stale service containers + network BEFORE network create", async () => {
    const cfg = baseCfg({ services: [DB] });
    const { runsRoot, ticketsPath } = setupRuns(cfg, 7, "wiki");
    const calls: { cmd: string; args: string[] }[] = [];
    const runner: import("../exec.js").Runner = async (cmd, args) => {
      calls.push({ cmd, args: [...args] });
      return { code: 0, stdout: "", stderr: "" };
    };

    await gradeAll(cfg, ticketsPath, runsRoot, "/bare.git", { local: false, image: "img", runner });

    const net = "bench-saleor-7-wiki-grade-net";
    const svc = "bench-saleor-7-wiki-grade-svc-db";
    const docker = calls.filter((c) => c.cmd === "docker").map((c) => c.args);

    const idxStaleRm = docker.findIndex((a) => a[0] === "rm" && a[1] === "-f" && a[2] === svc);
    const idxStaleNetRm = docker.findIndex((a) => a[0] === "network" && a[1] === "rm" && a[2] === net);
    const idxNetCreate = docker.findIndex((a) => a[0] === "network" && a[1] === "create" && a[2] === net);

    // Pre-clean rm + network rm both happen, and BEFORE the network create.
    expect(idxStaleRm).toBeGreaterThanOrEqual(0);
    expect(idxStaleNetRm).toBeGreaterThanOrEqual(0);
    expect(idxNetCreate).toBeGreaterThanOrEqual(0);
    expect(idxStaleRm).toBeLessThan(idxNetCreate);
    expect(idxStaleNetRm).toBeLessThan(idxNetCreate);
  });

  it("no pre-clean for a service-less config", async () => {
    const cfg = baseCfg({ services: [] });
    const { runsRoot, ticketsPath } = setupRuns(cfg, 7, "wiki");
    const calls: { cmd: string; args: string[] }[] = [];
    const runner: import("../exec.js").Runner = async (cmd, args) => {
      calls.push({ cmd, args: [...args] });
      return { code: 0, stdout: "", stderr: "" };
    };

    await gradeAll(cfg, ticketsPath, runsRoot, "/bare.git", { local: false, image: "img", runner });

    const docker = calls.filter((c) => c.cmd === "docker").map((c) => c.args);
    expect(docker.some((a) => a[0] === "network")).toBe(false);
    expect(docker.some((a) => a[0] === "rm")).toBe(false);
  });
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
