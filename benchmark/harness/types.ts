/** Shared types for the benchmark harness. See docs/superpowers/specs/2026-06-10-benchmark-harness-design.md. */

export type Arm = "baseline" | "wiki";

export type RunStatus =
  | "pending"
  | "running"
  | "ran" // session artifacts captured, grade not yet recorded
  | "passed"
  | "failed"
  | "error"
  | "rate-limited";

export interface RepoConfig {
  id: string;
  github: string; // "owner/name"
  clone_url: string;
  language: string;
  ticket_source: "github" | "trac-commits";
  install: string[];
  test_command: string; // must contain "{test_files}" (substituted with the RUNNABLE files)
  test_patterns: string[];
  run_patterns: string[]; // runnable-test subset of test_patterns; defaults to test_patterns
  exclude_test_paths: string[]; // tickets whose runnable tests touch these paths are excluded at mining
  test_retries: number;
  ticket_after: string; // ISO date floor (training-data contamination control)
  wiki_commit: string; // "" until the wiki is built
  toolchain: string[];
  services: string[];
}

export interface TicketCalibration {
  paths_stable: boolean;
  tests_fail_on_base: boolean;
  tests_pass_on_fix: boolean;
}

export interface TicketRecord {
  issue: number;
  issue_url: string;
  title: string;
  body: string; // verbatim, for audit
  body_sanitized: string; // what sessions receive
  fix_pr: number;
  fix_pr_url: string;
  base_commit: string; // fix PR parent — what the agent gets
  fix_commit: string; // fix PR merge commit
  test_files: string[]; // all test-side files from the fix PR — overlaid at grade time
  src_files: string[];
  run_files?: string[]; // runnable subset of test_files handed to the test command; absent in legacy records (fall back to test_files)
  changed_lines: number;
  merge_parents?: number; // parents of the merge commit; >1 = true merge, base_commit may predate the PR
  merged_at: string; // ISO timestamp, published for contamination audit
  calibration?: TicketCalibration;
  excluded?: string; // exclusion reason; excluded tickets never run
}

export interface TicketsFile {
  schema_version: 1;
  repo: string;
  mined_at: string;
  tickets: TicketRecord[];
}

export interface RunRecord {
  status: RunStatus;
  started_at?: string;
  finished_at?: string;
  cost_usd?: number;
  session_id?: string;
  detail?: string; // error text / rate-limit reset hint / grade detail
}

export interface BenchState {
  schema_version: 1;
  repo: string;
  runs: Record<string, RunRecord>; // key: `${issue}:${arm}`
}

export interface SessionResult {
  kind: "ok" | "rate-limited" | "error";
  costUsd?: number;
  sessionId?: string;
  detail?: string;
}

export type GradeOutcome = "passed" | "failed";

export type GradeDetail = "apply-failed" | "tests-failed" | "tests-passed" | "tests-passed-on-retry";

export interface GradeRecord {
  outcome: GradeOutcome;
  detail: GradeDetail; // "apply-failed" | "tests-failed" | "tests-passed" | "tests-passed-on-retry"
  graded_at: string;
}
