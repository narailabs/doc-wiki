import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Runner } from "../exec.js";
import { realRunner } from "../exec.js";
import { gradeAll } from "../grade.js";
import { renderResults } from "../report.js";
import { runBatch } from "../run_ticket.js";
import { loadState } from "../bench_checkpoint.js";
import type { RepoConfig, TicketsFile } from "../types.js";

function fixtureRepo(): { bare: string; base: string; fix: string; goodDiff: string } {
  const src = mkdtempSync(join(tmpdir(), "e2e-src-"));
  const git = (...a: string[]): string => execFileSync("git", a, { cwd: src, encoding: "utf8" }).trim();
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@t"); git("config", "user.name", "t");
  writeFileSync(join(src, "calc.js"), "module.exports = (a, b) => a - b;\n");
  git("add", "-A"); git("commit", "-qm", "base");
  const base = git("rev-parse", "HEAD");
  writeFileSync(join(src, "calc.js"), "module.exports = (a, b) => a + b;\n");
  mkdirSync(join(src, "test"));
  writeFileSync(join(src, "test", "calc.test.js"),
    "const c = require('../calc.js');\nif (c(1, 2) !== 3) process.exit(1);\n");
  git("add", "-A"); git("commit", "-qm", "fix");
  const fix = git("rev-parse", "HEAD");
  // execFileSync (not the trimming helper) — git apply requires a trailing newline.
  const goodDiff = execFileSync("git", ["diff", "--binary", base, fix, "--", "calc.js"], { cwd: src, encoding: "utf8" });
  const bare = `${mkdtempSync(join(tmpdir(), "e2e-bare-"))}/repo.git`;
  execFileSync("git", ["clone", "-q", "--bare", src, bare]);
  return { bare, base, fix, goodDiff };
}

describe("e2e smoke: run -> grade -> report (fake claude, real git)", () => {
  it("baseline fails, wiki passes, report shows the delta", async () => {
    const { bare, base, fix, goodDiff } = fixtureRepo();
    const root = mkdtempSync(join(tmpdir(), "e2e-root-"));
    const cfg: RepoConfig = {
      id: "demo", github: "acme/demo", clone_url: "x", language: "js",
      ticket_source: "github", install: [], test_command: "node {test_files}",
      test_patterns: ["test/**"], test_retries: 0, ticket_after: "2025-01-01",
      wiki_commit: base, toolchain: ["node:22"], services: [],
    };
    const tickets: TicketsFile = {
      schema_version: 1, repo: "demo", mined_at: "x",
      tickets: [{
        issue: 7, issue_url: "u", title: "subtraction instead of addition", body: "b", body_sanitized: "b",
        fix_pr: 8, fix_pr_url: "u", base_commit: base, fix_commit: fix,
        test_files: ["test/calc.test.js"], src_files: ["calc.js"], changed_lines: 2,
        merged_at: "2025-09-01T00:00:00Z",
        calibration: { paths_stable: true, tests_fail_on_base: true, tests_pass_on_fix: true },
      }],
    };
    mkdirSync(join(root, "tickets"), { recursive: true });
    const ticketsPath = join(root, "tickets", "demo.json");
    writeFileSync(ticketsPath, JSON.stringify(tickets));

    // Wiki overlay with the sentinel the orchestrator checks for.
    const overlay = mkdtempSync(join(tmpdir(), "e2e-overlay-"));
    writeFileSync(join(overlay, "CLAUDE.md"), "wiki pointer");

    // Fake docker: the "wiki" arm's agent writes the correct fix; "baseline" writes nothing.
    const fakeDocker: Runner = async (_cmd, args) => {
      if (args[0] !== "run") return { code: 0, stdout: "", stderr: "" };
      const outDir = String(args.find((a) => a.includes(":/out"))).split(":")[0];
      const isWiki = args.some((a) => a.includes(":/wiki"));
      writeFileSync(join(String(outDir), "result.json"),
        JSON.stringify({ result: "done", total_cost_usd: 0.3, session_id: "s" }));
      writeFileSync(join(String(outDir), "stderr.log"), "");
      writeFileSync(join(String(outDir), "exit_code"), "0");
      writeFileSync(join(String(outDir), "diff.patch"), isWiki ? goodDiff : "");
      return { code: 0, stdout: "", stderr: "" };
    };

    const runsRoot = join(root, "runs");
    const summary = await runBatch({
      cfg, ticketsPath, runsRoot, bareDir: bare, wikiDir: overlay,
      image: "img", model: "m", maxTurns: 10, batch: 5, timeoutSec: 60, runner: fakeDocker,
    });
    expect(summary.ran).toBe(2);

    await gradeAll(cfg, ticketsPath, runsRoot, bare, { local: true, image: "img", runner: realRunner });

    const state = loadState(join(runsRoot, "demo", "state.json"), "demo");
    expect(state.runs["7:baseline"]?.status).toBe("failed");
    expect(state.runs["7:wiki"]?.status).toBe("passed");

    const md = renderResults("demo", tickets.tickets, state);
    expect(md).toContain("| baseline | 0/1 (0%) |");
    expect(md).toContain("| wiki | 1/1 (100%) |");
  }, 30_000);
});
