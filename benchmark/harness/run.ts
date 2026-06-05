#!/usr/bin/env -S npx tsx
// doc-wiki benchmark runner.
//
// For each (repo, issue, condition) in repos.yaml:
//   1. Clone the repo at the parent of the fix commit into a temp workdir
//   2. Install dependencies per the repo's setup[] commands
//   3. If condition=with-docwiki, run `/doc-wiki:atlas` to build the wiki
//   4. Invoke `claude -p "<issue prompt>" --output-format=json --max-turns=N`
//   5. Run the specific test that the fix PR added/modified
//   6. Write the result JSON to runs/<repo>/<issue>/<condition>.json
//
// Resumable: existing result files are skipped unless --force.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { load as yamlLoad } from "js-yaml";

interface RepoConfig {
  id: string;
  url: string;
  lang: string;
  setup: string[];
  test_cmd: string;
  issues: IssueConfig[];
}

interface IssueConfig {
  id: string;
  title: string;
  body: string;
  fix_commit: string;
  test_path: string;
}

interface Defaults {
  model: string;
  max_turns: number;
  per_run_cost_cap_usd: number;
  atlas_max_cost_usd: number;
  conditions: Condition[];
}

interface Manifest {
  repos: RepoConfig[];
  defaults: Defaults;
}

type Condition = "baseline" | "with-docwiki";

interface RunResult {
  schema_version: 1;
  repo: string;
  issue: string;
  condition: Condition;
  model: string;
  started_at: string;
  finished_at: string;
  duration_s: number;
  setup_ok: boolean;
  atlas: { ran: boolean; duration_s: number; cost_usd: number } | null;
  claude: {
    exit_code: number;
    turns: number;
    tokens_in: number;
    tokens_out: number;
    cost_usd: number;
    raw: unknown;
  };
  test: {
    exit_code: number;
    success: boolean;
    stdout_tail: string;
  };
  diff: string;
  error?: string;
}

interface CliArgs {
  repo?: string;
  issue?: string;
  condition?: Condition;
  force: boolean;
  dryRun: boolean;
  mock: boolean;
}

const HERE = dirname(fileURLToPath(import.meta.url));
const BENCH_DIR = resolve(HERE, "..");
const RUNS_DIR = join(BENCH_DIR, "runs");
const MANIFEST_PATH = join(BENCH_DIR, "repos.yaml");

function parseArgs(argv: readonly string[]): CliArgs {
  const out: CliArgs = { force: false, dryRun: false, mock: false };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === "--repo") out.repo = argv[++i];
    else if (t === "--issue") out.issue = argv[++i];
    else if (t === "--condition") {
      const v = argv[++i];
      if (v !== "baseline" && v !== "with-docwiki") {
        throw new Error(`--condition must be baseline|with-docwiki, got ${v}`);
      }
      out.condition = v;
    } else if (t === "--force") out.force = true;
    else if (t === "--dry-run") out.dryRun = true;
    else if (t === "--mock") out.mock = true;
    else if (t === "-h" || t === "--help") {
      console.log(
        "Usage: run.ts [--repo <id>] [--issue <id>] [--condition baseline|with-docwiki] [--force] [--dry-run] [--mock]",
      );
      console.log(
        "  --mock  generate synthetic run results without invoking Claude / building anything",
      );
      process.exit(0);
    } else {
      throw new Error(`unrecognized argument: ${t}`);
    }
  }
  return out;
}

// Deterministic synthetic-result generator for --mock. Hash-seeded so the
// same (repo, issue, condition) triple always emits the same numbers.
function mockResult(
  repo: RepoConfig,
  issue: IssueConfig,
  condition: Condition,
  defaults: Defaults,
): RunResult {
  const seed = parseInt(
    createHash("sha256")
      .update(`${repo.id}/${issue.id}/${condition}`)
      .digest("hex")
      .slice(0, 8),
    16,
  );
  const rand = (lo: number, hi: number, offset = 0) => {
    const x = ((seed + offset) * 2654435761) >>> 0; // Knuth multiplicative hash
    return lo + (hi - lo) * ((x % 10_000) / 10_000);
  };
  const success =
    condition === "baseline" ? rand(0, 1, 1) < 0.18 : rand(0, 1, 1) < 0.72;
  const cost = condition === "baseline" ? rand(0.3, 1.6, 2) : rand(0.8, 3.5, 2);
  const turns = Math.round(rand(6, 22, 3));
  const tokens_in = Math.round(rand(8_000, 60_000, 4));
  const tokens_out = Math.round(rand(1_500, 9_000, 5));
  const now = new Date().toISOString();
  return {
    schema_version: 1,
    repo: repo.id,
    issue: issue.id,
    condition,
    model: defaults.model,
    started_at: now,
    finished_at: now,
    duration_s: Math.round(rand(40, 600, 6)),
    setup_ok: true,
    atlas:
      condition === "with-docwiki"
        ? { ran: true, duration_s: Math.round(rand(120, 1800, 7)), cost_usd: rand(2.5, 18.0, 8) }
        : null,
    claude: {
      exit_code: 0,
      turns,
      tokens_in,
      tokens_out,
      cost_usd: cost,
      raw: { mock: true },
    },
    test: {
      exit_code: success ? 0 : 1,
      success,
      stdout_tail: success ? "ok\n" : "FAILED (1 failure)\n",
    },
    diff: "(mock — no diff)",
  };
}

function loadManifest(): Manifest {
  const text = readFileSync(MANIFEST_PATH, "utf-8");
  return yamlLoad(text) as Manifest;
}

function resultPath(repo: string, issue: string, condition: Condition): string {
  return join(RUNS_DIR, repo, issue, `${condition}.json`);
}

function writeResult(result: RunResult): void {
  const p = resultPath(result.repo, result.issue, result.condition);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(result, null, 2));
  console.log(`  → wrote ${p}`);
}

function sh(cmd: string, cwd: string, captureOutput = false): { code: number; stdout: string; stderr: string } {
  const cp = spawnSync("bash", ["-c", cmd], {
    cwd,
    encoding: "utf-8",
    stdio: captureOutput ? ["ignore", "pipe", "pipe"] : ["ignore", "inherit", "inherit"],
    maxBuffer: 200 * 1024 * 1024,
  });
  return {
    code: cp.status ?? -1,
    stdout: cp.stdout ?? "",
    stderr: cp.stderr ?? "",
  };
}

function prepareCheckout(repo: RepoConfig, issue: IssueConfig, workDir: string): boolean {
  if (existsSync(workDir)) rmSync(workDir, { recursive: true, force: true });
  mkdirSync(workDir, { recursive: true });
  const clone = sh(`git clone --quiet ${repo.url} ${workDir}`, BENCH_DIR);
  if (clone.code !== 0) return false;
  // Check out the parent of the fix commit (= state before the fix).
  const checkout = sh(`git checkout --quiet ${issue.fix_commit}^1`, workDir);
  return checkout.code === 0;
}

function runSetup(repo: RepoConfig, workDir: string): boolean {
  for (const cmd of repo.setup) {
    const r = sh(cmd, workDir);
    if (r.code !== 0) {
      console.error(`  setup failed: ${cmd}`);
      return false;
    }
  }
  return true;
}

function buildPrompt(repo: RepoConfig, issue: IssueConfig): string {
  return `You are working in a git checkout of the ${repo.id} codebase. The issue below describes a bug or change request that maintainers later fixed.

<issue_title>
${issue.title}
</issue_title>

<issue_body>
${issue.body.trim()}
</issue_body>

Investigate the codebase, identify the change needed, and apply it. When you're done, the test at \`${issue.test_path}\` should pass. Do not modify the test itself. Do not modify unrelated tests.`;
}

interface ClaudeRunResult {
  exit_code: number;
  duration_s: number;
  turns: number;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  raw: unknown;
}

function runClaude(
  prompt: string,
  cwd: string,
  defaults: Defaults,
): ClaudeRunResult {
  const start = Date.now();
  const cp = spawnSync(
    "claude",
    [
      "-p",
      prompt,
      "--output-format=json",
      "--max-turns",
      String(defaults.max_turns),
      "--model",
      defaults.model,
    ],
    {
      cwd,
      encoding: "utf-8",
      maxBuffer: 200 * 1024 * 1024,
    },
  );
  const duration_s = (Date.now() - start) / 1000;

  let raw: unknown = null;
  let turns = 0;
  let tokens_in = 0;
  let tokens_out = 0;
  let cost_usd = 0;
  try {
    if (cp.stdout) {
      raw = JSON.parse(cp.stdout);
      // Defensive extraction — Claude Code's JSON shape may differ across versions.
      const r = raw as Record<string, unknown>;
      turns = typeof r.num_turns === "number" ? r.num_turns : 0;
      const usage = (r.total_cost as Record<string, unknown>) ?? r;
      if (usage && typeof usage === "object") {
        const u = usage as Record<string, unknown>;
        cost_usd =
          typeof u.total_cost_usd === "number"
            ? u.total_cost_usd
            : typeof u.cost_usd === "number"
              ? u.cost_usd
              : 0;
        tokens_in =
          typeof u.input_tokens === "number"
            ? u.input_tokens
            : typeof u.tokens_in === "number"
              ? u.tokens_in
              : 0;
        tokens_out =
          typeof u.output_tokens === "number"
            ? u.output_tokens
            : typeof u.tokens_out === "number"
              ? u.tokens_out
              : 0;
      }
    }
  } catch {
    raw = { parse_error: true, stdout_tail: cp.stdout.slice(-1000) };
  }

  return {
    exit_code: cp.status ?? -1,
    duration_s,
    turns,
    tokens_in,
    tokens_out,
    cost_usd,
    raw,
  };
}

function runAtlas(workDir: string, defaults: Defaults): {
  ran: boolean;
  duration_s: number;
  cost_usd: number;
} {
  const start = Date.now();
  const cp = spawnSync(
    "claude",
    [
      "-p",
      `/doc-wiki:init && /doc-wiki:atlas --max-cost ${defaults.atlas_max_cost_usd}`,
      "--output-format=json",
      "--max-turns",
      "200",
      "--model",
      defaults.model,
    ],
    { cwd: workDir, encoding: "utf-8", maxBuffer: 200 * 1024 * 1024 },
  );
  const duration_s = (Date.now() - start) / 1000;
  let cost_usd = 0;
  try {
    const out = JSON.parse(cp.stdout) as Record<string, unknown>;
    const u =
      typeof out.total_cost_usd === "number"
        ? out.total_cost_usd
        : typeof out.cost_usd === "number"
          ? (out.cost_usd as number)
          : 0;
    cost_usd = u;
  } catch {
    /* ignore */
  }
  return { ran: cp.status === 0, duration_s, cost_usd };
}

function runTargetTest(repo: RepoConfig, issue: IssueConfig, workDir: string): {
  exit_code: number;
  success: boolean;
  stdout_tail: string;
} {
  const cmd = repo.test_cmd.replace("{test_path}", issue.test_path);
  const r = sh(cmd, workDir, true);
  return {
    exit_code: r.code,
    success: r.code === 0,
    stdout_tail: (r.stdout + r.stderr).slice(-2000),
  };
}

function gitDiff(workDir: string): string {
  const r = sh("git diff --no-color HEAD", workDir, true);
  return r.stdout.slice(0, 200_000);
}

async function runOne(
  repo: RepoConfig,
  issue: IssueConfig,
  condition: Condition,
  defaults: Defaults,
  args: CliArgs,
): Promise<void> {
  const outPath = resultPath(repo.id, issue.id, condition);
  if (existsSync(outPath) && !args.force) {
    console.log(`  skip (already recorded): ${outPath}`);
    return;
  }
  if (args.dryRun) {
    console.log(`  dry-run: would run ${repo.id}/${issue.id}/${condition}`);
    return;
  }
  if (args.mock) {
    console.log(`  mock: ${repo.id}/${issue.id}/${condition}`);
    writeResult(mockResult(repo, issue, condition, defaults));
    return;
  }

  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const workDir = join(tmpdir(), "doc-wiki-bench", `${repo.id}-${issue.id}-${condition}`);

  console.log(`\n=== ${repo.id} / ${issue.id} / ${condition} ===`);

  const result: RunResult = {
    schema_version: 1,
    repo: repo.id,
    issue: issue.id,
    condition,
    model: defaults.model,
    started_at: startedAt,
    finished_at: "",
    duration_s: 0,
    setup_ok: false,
    atlas: null,
    claude: { exit_code: -1, turns: 0, tokens_in: 0, tokens_out: 0, cost_usd: 0, raw: null },
    test: { exit_code: -1, success: false, stdout_tail: "" },
    diff: "",
  };

  try {
    if (!prepareCheckout(repo, issue, workDir)) {
      result.error = "checkout failed";
      return;
    }
    if (!runSetup(repo, workDir)) {
      result.error = "setup failed";
      return;
    }
    result.setup_ok = true;

    if (condition === "with-docwiki") {
      result.atlas = runAtlas(workDir, defaults);
      if (!result.atlas.ran) {
        result.error = "atlas failed";
        return;
      }
    }

    const prompt = buildPrompt(repo, issue);
    const claudeRes = runClaude(prompt, workDir, defaults);
    result.claude = claudeRes;

    if (claudeRes.cost_usd > defaults.per_run_cost_cap_usd) {
      console.warn(
        `  ⚠ cost cap exceeded: ${claudeRes.cost_usd.toFixed(2)} > ${defaults.per_run_cost_cap_usd}`,
      );
    }

    result.test = runTargetTest(repo, issue, workDir);
    result.diff = gitDiff(workDir);
  } catch (e) {
    result.error = e instanceof Error ? e.message : String(e);
  } finally {
    result.finished_at = new Date().toISOString();
    result.duration_s = (Date.now() - t0) / 1000;
    writeResult(result);
    // Leave workDir on disk so the user can inspect failures; harness V2 can prune.
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const manifest = loadManifest();

  const repos = args.repo
    ? manifest.repos.filter((r) => r.id === args.repo)
    : manifest.repos;
  if (repos.length === 0) {
    throw new Error(`no repos matched (--repo=${args.repo})`);
  }

  const conditions: Condition[] = args.condition
    ? [args.condition]
    : manifest.defaults.conditions;

  for (const repo of repos) {
    const issues = args.issue
      ? repo.issues.filter((i) => i.id === args.issue)
      : repo.issues;
    if (issues.length === 0) continue;
    for (const issue of issues) {
      for (const condition of conditions) {
        await runOne(repo, issue, condition, manifest.defaults, args);
      }
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
