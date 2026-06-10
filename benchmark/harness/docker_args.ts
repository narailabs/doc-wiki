export interface SessionSpec {
  image: string;
  outDir: string; // absolute host path for /out
  bareDir: string; // absolute host path of the cached bare clone
  wikiDir?: string; // absolute host path of the wiki overlay (wiki arm only)
  baseCommit: string;
  model: string;
  maxTurns: number;
  install: string[];
  timeoutSec: number; // consumed host-side by the run orchestrator (container wall-clock kill); not part of argv
}

/** docker run argv for one agent session. The OAuth token is passed by NAME only (-e VAR) so it never appears in argv/process listings. */
export function sessionRunArgs(s: SessionSpec): string[] {
  const args = [
    "run", "--rm",
    "--cap-add=NET_ADMIN",
    "--stop-timeout", "10",
    "-v", `${s.bareDir}:/bare:ro`,
    "-v", `${s.outDir}:/out`,
    "-e", "CLAUDE_CODE_OAUTH_TOKEN",
    "-e", `BENCH_BASE_COMMIT=${s.baseCommit}`,
    "-e", `BENCH_MODEL=${s.model}`,
    "-e", `BENCH_MAX_TURNS=${s.maxTurns}`,
    "-e", `BENCH_INSTALL=${s.install.join(" && ")}`,
  ];
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
  testCommand: string;
  retries: number;
}

export function gradeRunArgs(g: GradeSpec): string[] {
  return [
    "run", "--rm",
    "-v", `${g.bareDir}:/bare:ro`,
    "-v", `${g.outDir}:/out`,
    "-e", `BENCH_BASE_COMMIT=${g.baseCommit}`,
    "-e", `BENCH_FIX_COMMIT=${g.fixCommit}`,
    "-e", `BENCH_TEST_FILES=${g.testFiles.join(" ")}`,
    "-e", `BENCH_TEST_COMMAND=${g.testCommand}`,
    "-e", `BENCH_RETRIES=${g.retries}`,
    g.image, "grade",
  ];
}

export function buildImageArgs(tag: string, toolchain: string, contextDir: string): string[] {
  return ["build", "-t", tag, "--build-arg", `TOOLCHAIN=${toolchain}`, contextDir];
}
