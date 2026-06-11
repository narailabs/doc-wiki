import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseFlags } from "../../skills/doc-wiki/scripts/_cli_args.js";
import { loadState, saveState } from "./bench_checkpoint.js";
import { gradeRunArgs } from "./docker_args.js";
import type { GradeSpec } from "./docker_args.js";
import type { Runner } from "./exec.js";
import { realRunner } from "./exec.js";
import { loadRepoConfig } from "./repo_config.js";
import { networkName, startSidecars, teardownSidecars } from "./services.js";
import type { GradeRecord, RepoConfig, TicketsFile } from "./types.js";

const GRADE_SH = fileURLToPath(new URL("./docker/grade.sh", import.meta.url));

export function decideGrade(exitCode: number): Omit<GradeRecord, "graded_at"> {
  if (exitCode === 0) return { outcome: "passed", detail: "tests-passed" };
  if (exitCode === 5) return { outcome: "passed", detail: "tests-passed-on-retry" };
  if (exitCode === 10) return { outcome: "failed", detail: "apply-failed" };
  if (exitCode === 20) return { outcome: "failed", detail: "tests-failed" };
  throw new Error(`grade.sh setup error (exit ${exitCode})`);
}

export interface GradeLocalSpec {
  bareDir: string;
  outDir: string;
  baseCommit: string;
  fixCommit: string;
  testFiles: string[];
  /** Runnable subset substituted into {test_files}; defaults to testFiles (legacy records). */
  runFiles?: string[];
  testCommand: string;
  retries: number;
  mode?: "grade" | "calibrate-base" | "calibrate-fix";
  runner?: Runner;
}

/** Run grade.sh directly on the host (tests/e2e) — same contract as the docker path. */
export async function gradeRunLocal(spec: GradeLocalSpec): Promise<Omit<GradeRecord, "graded_at">> {
  const runner = spec.runner ?? realRunner;
  const r = await runner("bash", [GRADE_SH], {
    env: {
      ...process.env,
      BENCH_BARE_DIR: spec.bareDir,
      BENCH_OUT_DIR: spec.outDir,
      BENCH_BASE_COMMIT: spec.baseCommit,
      BENCH_FIX_COMMIT: spec.fixCommit,
      BENCH_TEST_FILES: spec.testFiles.join(" "),
      BENCH_RUN_FILES: (spec.runFiles ?? spec.testFiles).join(" "),
      BENCH_TEST_COMMAND: spec.testCommand,
      BENCH_RETRIES: String(spec.retries),
      BENCH_GRADE_MODE: spec.mode ?? "grade",
    },
  });
  return decideGrade(r.code);
}

/** Single container-grade code path: run grade.sh inside the image, optionally on a sidecar network with extra env. */
async function gradeRunContainer(
  spec: GradeSpec,
  net: string | undefined,
  extraEnv: Record<string, string>,
  runner: Runner,
): Promise<Omit<GradeRecord, "graded_at">> {
  const r = await runner("docker", gradeRunArgs({
    ...spec,
    network: net,
    extraEnv: Object.keys(extraEnv).length > 0 ? extraEnv : undefined,
  }));
  return decideGrade(r.code);
}

/** Calibrate every un-calibrated ticket; failures get `excluded` set. Mutates + rewrites the tickets file after every ticket (each costs a clone+install+2 test runs — a crash loses at most one). */
export async function calibrateAll(cfg: RepoConfig, ticketsPath: string, bareDir: string, opts: { local: boolean; image: string; runner: Runner }): Promise<void> {
  const file = JSON.parse(readFileSync(ticketsPath, "utf8")) as TicketsFile;
  const installPrefix = cfg.install.length > 0 ? `${cfg.install.join(" && ")} && ` : "";
  // Service-backed repos can't calibrate on the host: the DB/cache hostnames (e.g. db:5432) only resolve
  // INSIDE the docker network, and container_env (DATABASE_URL/...) targets them. Route through the same
  // container+sidecar path the grade uses. (Requires the repo image to be built first — `build-image`.)
  const hasSidecars = cfg.services.length > 0;
  for (const t of file.tickets) {
    if (t.calibration !== undefined || t.excluded !== undefined) continue;
    const common = {
      bareDir, outDir: bareDir, baseCommit: t.base_commit, fixCommit: t.fix_commit,
      testFiles: t.test_files, runFiles: t.run_files ?? t.test_files,
      testCommand: installPrefix + cfg.test_command, retries: 0, runner: opts.runner,
    };
    try {
      // paths_stable: every test_file exists at fix_commit (renamed/deleted test files excluded).
      // Missing-at-base is fine — the canonical fix PR ADDS a regression test; calibrate-base overlays it from fix.
      // testsExistAtFix is a host-side `git -C bareDir cat-file` check — no container needed either way.
      const stable = await testsExistAtFix(opts.runner, bareDir, t.fix_commit, t.test_files);
      let failsOnBase = false;
      let passesOnFix = false;
      if (stable) {
        if (hasSidecars) {
          // Start sidecars ONCE per ticket, wrapping BOTH the base and fix runs; teardown in finally.
          const prefix = `bench-${cfg.id}-${t.issue}-calib`;
          const net = networkName(prefix);
          const extraEnv = { ...cfg.container_env, BENCH_ALLOW_PRIVATE_NET: "1" };
          const containerSpec = {
            image: opts.image, outDir: bareDir, bareDir, baseCommit: t.base_commit, fixCommit: t.fix_commit,
            testFiles: t.test_files, runFiles: t.run_files ?? t.test_files,
            testCommand: installPrefix + cfg.test_command, retries: 0,
          };
          try {
            await startSidecars(opts.runner, net, prefix, cfg.services);
            failsOnBase = (await gradeRunContainer({ ...containerSpec, mode: "calibrate-base" }, net, extraEnv, opts.runner)).outcome === "passed";
            passesOnFix = failsOnBase && (await gradeRunContainer({ ...containerSpec, mode: "calibrate-fix" }, net, extraEnv, opts.runner)).outcome === "passed";
          } finally {
            await teardownSidecars(opts.runner, net, prefix, cfg.services);
          }
        } else {
          failsOnBase = (await gradeRunLocal({ ...common, mode: "calibrate-base" })).outcome === "passed";
          passesOnFix = failsOnBase && (await gradeRunLocal({ ...common, mode: "calibrate-fix" })).outcome === "passed";
        }
      }
      t.calibration = { paths_stable: stable, tests_fail_on_base: failsOnBase, tests_pass_on_fix: passesOnFix };
      if (!stable || !failsOnBase || !passesOnFix) {
        t.excluded = `calibration-failed (stable=${stable} failsOnBase=${failsOnBase} passesOnFix=${passesOnFix})`;
      }
    } catch (err) {
      // setup error (grade.sh exit 64: bad checkout, clone failure) — exclude, don't crash the sweep
      t.calibration = { paths_stable: false, tests_fail_on_base: false, tests_pass_on_fix: false };
      t.excluded = `calibration-error (${err instanceof Error ? err.message : String(err)})`;
    }
    if (t.excluded !== undefined) process.stderr.write(`issue #${t.issue}: ${t.excluded}\n`);
    writeTickets(ticketsPath, file);
  }
  writeTickets(ticketsPath, file);
}

/** Atomic tmp+rename, same pattern as saveState — a crash mid-write must not truncate the committed ticket set. */
function writeTickets(ticketsPath: string, file: TicketsFile): void {
  const tmp = `${ticketsPath}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(file, null, 2)}\n`);
  renameSync(tmp, ticketsPath);
}

/** Every test_file must exist at the FIX commit; missing there = renamed away/deleted → ill-defined overlay. */
async function testsExistAtFix(runner: Runner, bareDir: string, fix: string, files: string[]): Promise<boolean> {
  for (const f of files) {
    const r = await runner("git", ["-C", bareDir, "cat-file", "-e", `${fix}:${f}`]);
    if (r.code !== 0) return false;
  }
  return true;
}

/** Grade every `ran` run that has no grade yet. */
export async function gradeAll(cfg: RepoConfig, ticketsPath: string, runsRoot: string, bareDir: string, opts: { local: boolean; image: string; runner: Runner }): Promise<void> {
  const file = JSON.parse(readFileSync(ticketsPath, "utf8")) as TicketsFile;
  const byIssue = new Map(file.tickets.map((t) => [t.issue, t]));
  const stateFile = join(runsRoot, cfg.id, "state.json");
  const state = loadState(stateFile, cfg.id);
  const installPrefix = cfg.install.length > 0 ? `${cfg.install.join(" && ")} && ` : "";

  for (const [key, rec] of Object.entries(state.runs)) {
    if (rec.status !== "ran") continue;
    const [issueStr, arm] = key.split(":");
    const t = byIssue.get(Number(issueStr));
    if (t === undefined) {
      process.stderr.write(`${key}: ran run has no ticket in ${ticketsPath} — skipped\n`);
      continue;
    }
    const outDir = resolve(runsRoot, cfg.id, String(t.issue), String(arm));

    try {
      let graded: Omit<GradeRecord, "graded_at">;
      if (opts.local) {
        // Use the result directly — round-tripping through exit codes would lose the retry distinction.
        graded = await gradeRunLocal({
          bareDir, outDir, baseCommit: t.base_commit, fixCommit: t.fix_commit,
          testFiles: t.test_files, runFiles: t.run_files ?? t.test_files,
          testCommand: installPrefix + cfg.test_command,
          retries: cfg.test_retries, runner: opts.runner,
        });
      } else {
        const hasSidecars = cfg.services.length > 0;
        const gradePrefix = `bench-${cfg.id}-${t.issue}-${String(arm)}-grade`;
        const net = hasSidecars ? networkName(gradePrefix) : undefined;
        try {
          if (hasSidecars && net !== undefined) {
            await startSidecars(opts.runner, net, gradePrefix, cfg.services);
          }
          const extraEnv: Record<string, string> = {
            ...cfg.container_env,
            ...(hasSidecars ? { BENCH_ALLOW_PRIVATE_NET: "1" } : {}),
          };
          graded = await gradeRunContainer({
            image: opts.image, outDir, bareDir, baseCommit: t.base_commit, fixCommit: t.fix_commit,
            testFiles: t.test_files, runFiles: t.run_files ?? t.test_files,
            testCommand: installPrefix + cfg.test_command, retries: cfg.test_retries,
          }, net, extraEnv, opts.runner);
        } finally {
          if (hasSidecars && net !== undefined) {
            await teardownSidecars(opts.runner, net, gradePrefix, cfg.services);
          }
        }
      }
      const grade: GradeRecord = { ...graded, graded_at: new Date().toISOString() };
      writeFileSync(join(outDir, "grade.json"), `${JSON.stringify(grade, null, 2)}\n`);
      rec.status = grade.outcome;
      rec.detail = grade.detail;
      saveState(stateFile, state);
      process.stderr.write(`${key}: ${grade.outcome} (${grade.detail})\n`);
    } catch (err) {
      // decideGrade throws on exit 64 (setup error) or unexpected docker failure — don't abort the sweep
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`${key}: grade error — ${message}\n`);
      rec.status = "error";
      rec.detail = message;
      saveState(stateFile, state);
    }
  }
}

export async function main(argv: readonly string[]): Promise<number> {
  const sub = argv[0];
  const { help, values } = parseFlags(argv.slice(1), {
    "--repo": "repo", "--local": "local", "--image": "image", "--bare-dir": "bareDir",
  });
  if (help || values.repo === undefined || (sub !== "calibrate" && sub !== "grade")) {
    process.stderr.write(
      "usage: benchmark <calibrate|grade> --repo <id> [--local] [--image i] [--bare-dir d]\n" +
        "note: calibrate always runs on the host (needs the repo's toolchain); --local/--image apply to grade only\n",
    );
    return help ? 0 : 2;
  }
  const repo = String(values.repo);
  const cfg = loadRepoConfig(join("benchmark", "repos", `${repo}.yaml`));
  const ticketsPath = join("benchmark", "tickets", `${repo}.json`);
  const shared = {
    local: values.local === true || values.local === "",
    image: String(values.image ?? `docwiki-bench-${repo}`),
    runner: realRunner,
  };
  const bareDir = String(values.bareDir ?? resolve("benchmark", "wiki-cache", `${repo}.git`));
  if (sub === "calibrate") await calibrateAll(cfg, ticketsPath, bareDir, shared);
  else await gradeAll(cfg, ticketsPath, join("benchmark", "runs"), bareDir, shared);
  return 0;
}
