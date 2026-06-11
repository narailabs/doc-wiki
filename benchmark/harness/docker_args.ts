export interface SessionSpec {
  image: string;
  name: string; // deterministic container name so the orchestrator can reap leaked containers
  outDir: string; // absolute host path for /out
  bareDir: string; // absolute host path of the cached bare clone
  wikiDir?: string; // absolute host path of the wiki overlay (wiki arm only)
  baseCommit: string;
  model: string;
  maxTurns: number;
  install: string[];
  timeoutSec: number; // consumed host-side by the run orchestrator (container wall-clock kill); not part of argv
  network?: string; // docker network to join (for sidecar connectivity)
  extraEnv?: Record<string, string>; // additional -e KEY=VALUE pairs injected into the container
}

/** docker run argv for one agent session. The OAuth token is passed by NAME only (-e VAR) so it never appears in argv/process listings. */
export function sessionRunArgs(s: SessionSpec): string[] {
  const args = [
    "run", "--rm",
    "--name", s.name,
  ];
  if (s.network !== undefined) args.push("--network", s.network);
  args.push(
    "--cap-add=NET_ADMIN",
    "--stop-timeout", "10",
    "-v", `${s.bareDir}:/bare:ro`,
    "-v", `${s.outDir}:/out`,
    "-e", "CLAUDE_CODE_OAUTH_TOKEN",
    "-e", `BENCH_BASE_COMMIT=${s.baseCommit}`,
    "-e", `BENCH_MODEL=${s.model}`,
    "-e", `BENCH_MAX_TURNS=${s.maxTurns}`,
    "-e", `BENCH_INSTALL=${s.install.join(" && ")}`,
  );
  if (s.extraEnv !== undefined) {
    for (const [k, v] of Object.entries(s.extraEnv)) args.push("-e", `${k}=${v}`);
  }
  if (s.wikiDir !== undefined) args.push("-v", `${s.wikiDir}:/wiki:ro`);
  args.push(s.image, "session");
  return args;
}

export interface GradeSpec {
  image: string;
  outDir: string;
  bareDir: string;
  baseCommit: string;
  fixCommit: string;
  testFiles: string[];
  /** Runnable subset substituted into {test_files}; defaults to testFiles. */
  runFiles?: string[];
  testCommand: string;
  retries: number;
  mode?: "grade" | "calibrate-base" | "calibrate-fix"; // BENCH_GRADE_MODE; omitted → grade.sh defaults to "grade"
  containerName?: string; // deterministic --name so a SIGKILL'd run can be reaped by pre-clean before re-create
  network?: string; // docker network to join (for sidecar connectivity)
  extraEnv?: Record<string, string>; // additional -e KEY=VALUE pairs injected into the container
}

export function gradeRunArgs(g: GradeSpec): string[] {
  const args = ["run", "--rm"];
  if (g.containerName !== undefined) args.push("--name", g.containerName);
  if (g.network !== undefined) args.push("--network", g.network);
  args.push(
    "-v", `${g.bareDir}:/bare:ro`,
    "-v", `${g.outDir}:/out`,
    "-e", `BENCH_BASE_COMMIT=${g.baseCommit}`,
    "-e", `BENCH_FIX_COMMIT=${g.fixCommit}`,
    "-e", `BENCH_TEST_FILES=${g.testFiles.join(" ")}`,
    "-e", `BENCH_RUN_FILES=${(g.runFiles ?? g.testFiles).join(" ")}`,
    "-e", `BENCH_TEST_COMMAND=${g.testCommand}`,
    "-e", `BENCH_RETRIES=${g.retries}`,
  );
  if (g.mode !== undefined) args.push("-e", `BENCH_GRADE_MODE=${g.mode}`);
  if (g.extraEnv !== undefined) {
    for (const [k, v] of Object.entries(g.extraEnv)) args.push("-e", `${k}=${v}`);
  }
  args.push(g.image, "grade");
  return args;
}

export function buildImageArgs(tag: string, toolchain: string, contextDir: string, extraApt?: string[]): string[] {
  const args = ["build", "-t", tag, "--build-arg", `TOOLCHAIN=${toolchain}`];
  if (extraApt !== undefined && extraApt.length > 0) {
    args.push("--build-arg", `EXTRA_APT=${extraApt.join(" ")}`);
  }
  args.push(contextDir);
  return args;
}
