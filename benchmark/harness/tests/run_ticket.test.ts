import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Runner } from "../exec.js";
import { runBatch } from "../run_ticket.js";
import { loadState, runKey, saveState, setRun } from "../bench_checkpoint.js";
import type { RepoConfig, TicketsFile } from "../types.js";

const CFG: RepoConfig = {
  id: "demo", github: "acme/demo", clone_url: "x", language: "ts",
  ticket_source: "github", install: ["true"], test_command: "t {test_files}",
  test_patterns: ["test/**"], test_retries: 0, ticket_after: "2025-06-01",
  wiki_commit: "cccc", toolchain: ["node:22"], services: [],
};

const ticket = (issue: number) => ({
  issue, issue_url: "u", title: `t${issue}`, body: "b", body_sanitized: "b",
  fix_pr: issue + 1, fix_pr_url: "u", base_commit: "bbbb", fix_commit: "aaaa",
  test_files: ["test/a.test.ts"], src_files: ["src/a.ts"], changed_lines: 10,
  merged_at: "2025-09-01T00:00:00Z",
  calibration: { paths_stable: true, tests_fail_on_base: true, tests_pass_on_fix: true },
});

function setup(tickets: TicketsFile["tickets"]): { root: string; ticketsPath: string; wikiDir: string } {
  const root = mkdtempSync(join(tmpdir(), "benchrun-"));
  mkdirSync(join(root, "tickets"), { recursive: true });
  const ticketsPath = join(root, "tickets", "demo.json");
  writeFileSync(ticketsPath, JSON.stringify({ schema_version: 1, repo: "demo", mined_at: "x", tickets }));
  // Built wiki overlay with its CLAUDE.md sentinel.
  const wikiDir = join(root, "overlay");
  mkdirSync(wikiDir);
  writeFileSync(join(wikiDir, "CLAUDE.md"), "# wiki\n");
  return { root, ticketsPath, wikiDir };
}

function writeOkArtifacts(outDir: string, costUsd: number, sessionId: string): void {
  writeFileSync(join(outDir, "result.json"), JSON.stringify({ result: "ok", total_cost_usd: costUsd, session_id: sessionId }));
  writeFileSync(join(outDir, "stderr.log"), "");
  writeFileSync(join(outDir, "exit_code"), "0");
  writeFileSync(join(outDir, "diff.patch"), "diff --git a/x b/x\n");
}

/** Fake docker: succeeds, writing a plausible /out result envelope. Ignores non-"run" invocations (container cleanup). */
const okDocker = (costs: number[]): Runner => async (cmd, args) => {
  expect(cmd).toBe("docker");
  if (args[0] !== "run") return { code: 0, stdout: "", stderr: "" };
  const outDir = String(args.find((a) => a.includes(":/out"))).split(":")[0];
  writeOkArtifacts(String(outDir), costs.shift() ?? 0.5, "s");
  return { code: 0, stdout: "", stderr: "" };
};

describe("runBatch", () => {
  it("runs both arms of each pair and records ran + cost", async () => {
    const { root, ticketsPath, wikiDir } = setup([ticket(1)]);
    const summary = await runBatch({
      cfg: CFG, ticketsPath, runsRoot: join(root, "runs"), bareDir: "/bare", wikiDir,
      image: "img", model: "claude-sonnet-4-6", maxTurns: 80, batch: 5, timeoutSec: 60,
      runner: okDocker([0.5, 0.7]),
    });
    expect(summary).toMatchObject({ ran: 2, rateLimited: 0, errors: 0 });
    const state = loadState(join(root, "runs", "demo", "state.json"), "demo");
    expect(state.runs[runKey(1, "baseline")]).toMatchObject({ status: "ran", cost_usd: 0.5 });
    expect(state.runs[runKey(1, "wiki")]).toMatchObject({ status: "ran", cost_usd: 0.7 });
  });

  it("stops the batch on rate-limit and persists the reset hint", async () => {
    const { root, ticketsPath, wikiDir } = setup([ticket(1), ticket(2)]);
    let calls = 0;
    const limited: Runner = async (_cmd, args) => {
      if (args[0] !== "run") return { code: 0, stdout: "", stderr: "" };
      const outDir = String(args.find((a) => a.includes(":/out"))).split(":")[0];
      calls += 1;
      const envelope = calls === 1
        ? { result: "ok", total_cost_usd: 0.5, session_id: "s" }
        : { result: "You've hit your session limit · resets 3:45pm", session_id: "s" };
      writeFileSync(join(String(outDir), "result.json"), JSON.stringify(envelope));
      writeFileSync(join(String(outDir), "stderr.log"), "");
      writeFileSync(join(String(outDir), "exit_code"), "0");
      writeFileSync(join(String(outDir), "diff.patch"), "");
      return { code: 0, stdout: "", stderr: "" };
    };
    const summary = await runBatch({
      cfg: CFG, ticketsPath, runsRoot: join(root, "runs"), bareDir: "/b", wikiDir,
      image: "img", model: "m", maxTurns: 80, batch: 5, timeoutSec: 60, runner: limited,
    });
    expect(summary).toMatchObject({ ran: 1, rateLimited: 1 });
    expect(calls).toBe(2); // ticket 2 never started
    const raw = JSON.parse(readFileSync(join(root, "runs", "demo", "state.json"), "utf8"));
    expect(raw.runs["1:wiki"].detail).toContain("resets 3:45pm");
    const state = loadState(join(root, "runs", "demo", "state.json"), "demo");
    expect(state.runs["2:baseline"]).toBeUndefined();
  });

  it("skips excluded tickets entirely", async () => {
    const { root, ticketsPath, wikiDir } = setup([{ ...ticket(3), excluded: "calibration-failed" }]);
    const summary = await runBatch({
      cfg: CFG, ticketsPath, runsRoot: join(root, "runs"), bareDir: "/b", wikiDir,
      image: "img", model: "m", maxTurns: 80, batch: 5, timeoutSec: 60,
      runner: async () => { throw new Error("must not be called"); },
    });
    expect(summary).toMatchObject({ ran: 0 });
  });

  it("records error and continues the batch", async () => {
    const { root, ticketsPath, wikiDir } = setup([ticket(1), ticket(2)]);
    let runs = 0;
    const flaky: Runner = async (_cmd, args) => {
      if (args[0] !== "run") return { code: 0, stdout: "", stderr: "" };
      runs += 1;
      const outDir = String(args.find((a) => a.includes(":/out"))).split(":")[0];
      if (runs === 1) {
        writeFileSync(join(String(outDir), "result.json"), "not json");
        writeFileSync(join(String(outDir), "stderr.log"), "");
        writeFileSync(join(String(outDir), "exit_code"), "0");
        writeFileSync(join(String(outDir), "diff.patch"), "");
      } else {
        writeOkArtifacts(String(outDir), 0.1, "s");
      }
      return { code: 0, stdout: "", stderr: "" };
    };
    const summary = await runBatch({
      cfg: CFG, ticketsPath, runsRoot: join(root, "runs"), bareDir: "/b", wikiDir,
      image: "img", model: "m", maxTurns: 80, batch: 5, timeoutSec: 60, runner: flaky,
    });
    expect(summary).toMatchObject({ ran: 3, rateLimited: 0, errors: 1 });
    expect(runs).toBe(4); // batch continued past the error
    const state = loadState(join(root, "runs", "demo", "state.json"), "demo");
    expect(state.runs[runKey(2, "baseline")]).toMatchObject({ status: "ran" });
    expect(state.runs[runKey(2, "wiki")]).toMatchObject({ status: "ran" });
  });

  it("resumes a partial pair: only the missing arm runs, the done arm is untouched", async () => {
    const { root, ticketsPath, wikiDir } = setup([ticket(1)]);
    const stateFile = join(root, "runs", "demo", "state.json");
    const pre = loadState(stateFile, "demo");
    setRun(pre, 1, "baseline", { status: "ran", cost_usd: 0.3, session_id: "old" });
    saveState(stateFile, pre);
    let runs = 0;
    const counting: Runner = async (_cmd, args) => {
      if (args[0] !== "run") return { code: 0, stdout: "", stderr: "" };
      runs += 1;
      const outDir = String(args.find((a) => a.includes(":/out"))).split(":")[0];
      writeOkArtifacts(String(outDir), 0.9, "new");
      return { code: 0, stdout: "", stderr: "" };
    };
    const summary = await runBatch({
      cfg: CFG, ticketsPath, runsRoot: join(root, "runs"), bareDir: "/b", wikiDir,
      image: "img", model: "m", maxTurns: 80, batch: 5, timeoutSec: 60, runner: counting,
    });
    expect(summary).toMatchObject({ ran: 1, rateLimited: 0, errors: 0 });
    expect(runs).toBe(1); // only the wiki arm went to docker
    const state = loadState(stateFile, "demo");
    expect(state.runs[runKey(1, "baseline")]).toMatchObject({ status: "ran", cost_usd: 0.3, session_id: "old" });
    expect(state.runs[runKey(1, "wiki")]).toMatchObject({ status: "ran", cost_usd: 0.9 });
  });

  it("reuses completed artifacts instead of re-spending", async () => {
    const { root, ticketsPath, wikiDir } = setup([ticket(1)]);
    // Crash-after-session leftovers: good artifacts, state never recorded `ran`.
    const baselineOut = join(root, "runs", "demo", "1", "baseline");
    mkdirSync(baselineOut, { recursive: true });
    writeOkArtifacts(baselineOut, 0.42, "pre");
    let runs = 0;
    const guard: Runner = async (_cmd, args) => {
      if (args[0] !== "run") return { code: 0, stdout: "", stderr: "" };
      runs += 1;
      const outDir = String(args.find((a) => a.includes(":/out"))).split(":")[0];
      expect(String(outDir)).not.toContain("baseline"); // baseline must not be re-run
      writeOkArtifacts(String(outDir), 0.6, "new");
      return { code: 0, stdout: "", stderr: "" };
    };
    const summary = await runBatch({
      cfg: CFG, ticketsPath, runsRoot: join(root, "runs"), bareDir: "/b", wikiDir,
      image: "img", model: "m", maxTurns: 80, batch: 5, timeoutSec: 60, runner: guard,
    });
    expect(summary).toMatchObject({ ran: 2, rateLimited: 0, errors: 0 });
    expect(runs).toBe(1); // only the wiki arm was paid for
    const state = loadState(join(root, "runs", "demo", "state.json"), "demo");
    expect(state.runs[runKey(1, "baseline")]).toMatchObject({ status: "ran", cost_usd: 0.42, session_id: "pre" });
    expect(state.runs[runKey(1, "wiki")]).toMatchObject({ status: "ran", cost_usd: 0.6 });
  });

  it("throws when a wiki arm is scheduled but the overlay is missing", async () => {
    const { root, ticketsPath } = setup([ticket(1)]);
    await expect(runBatch({
      cfg: CFG, ticketsPath, runsRoot: join(root, "runs"), bareDir: "/b",
      wikiDir: join(root, "no-such-overlay"),
      image: "img", model: "m", maxTurns: 80, batch: 5, timeoutSec: 60,
      runner: async () => { throw new Error("must not be called"); },
    })).rejects.toThrow(/build-wiki/);
  });
});

describe("container lifecycle ordering", () => {
  it("issues docker rm -f for the named container before each paid run", async () => {
    const { root, ticketsPath } = setup([ticket(1)]);
    const wikiDir = mkdtempSync(join(tmpdir(), "overlay-"));
    writeFileSync(join(wikiDir, "CLAUDE.md"), "wiki");
    const calls: string[][] = [];
    const recording: Runner = async (cmd, args) => {
      expect(cmd).toBe("docker");
      calls.push([...args]);
      if (args[0] !== "run") return { code: 0, stdout: "", stderr: "" };
      const outDir = String(args.find((a) => a.includes(":/out"))).split(":")[0];
      writeFileSync(join(String(outDir), "result.json"), JSON.stringify({ result: "ok", total_cost_usd: 0.1, session_id: "s" }));
      writeFileSync(join(String(outDir), "stderr.log"), "");
      writeFileSync(join(String(outDir), "exit_code"), "0");
      writeFileSync(join(String(outDir), "diff.patch"), "");
      return { code: 0, stdout: "", stderr: "" };
    };
    await runBatch({
      cfg: CFG, ticketsPath, runsRoot: join(root, "runs"), bareDir: "/b", wikiDir,
      image: "img", model: "m", maxTurns: 80, batch: 5, timeoutSec: 60, runner: recording,
    });
    const rmIdx = calls.findIndex((a) => a[0] === "rm" && a.includes("bench-demo-1-baseline"));
    const runIdx = calls.findIndex((a) => a[0] === "run" && a.includes("bench-demo-1-baseline"));
    expect(rmIdx).toBeGreaterThanOrEqual(0);
    expect(runIdx).toBeGreaterThan(rmIdx);
  });
});
