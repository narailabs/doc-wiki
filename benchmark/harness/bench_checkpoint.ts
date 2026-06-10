import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Arm, BenchState, RunRecord, RunStatus } from "./types.js";

const TERMINAL: ReadonlySet<RunStatus> = new Set(["passed", "failed"]);
const TRANSIENT: ReadonlySet<RunStatus> = new Set(["running", "error", "rate-limited"]);
const ARMS: readonly Arm[] = ["baseline", "wiki"];

export const runKey = (issue: number, arm: Arm): string => `${issue}:${arm}`;

/** Load (or initialize) state; transient statuses revert to pending so resume re-queues them. `ran` survives — it resumes as grade-only. */
export function loadState(file: string, repo: string): BenchState {
  if (!existsSync(file)) return { schema_version: 1, repo, runs: {} };
  const state = JSON.parse(readFileSync(file, "utf8")) as BenchState;
  if (state.repo !== repo) {
    throw new Error(`checkpoint ${file} belongs to repo "${state.repo}", not "${repo}"`);
  }
  for (const rec of Object.values(state.runs)) {
    if (TRANSIENT.has(rec.status)) rec.status = "pending";
  }
  return state;
}

/** Atomic write: tmp file + rename. */
export function saveState(file: string, state: BenchState): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`);
  renameSync(tmp, file);
}

export function setRun(state: BenchState, issue: number, arm: Arm, rec: RunRecord): void {
  const key = runKey(issue, arm);
  const prev = state.runs[key];
  if (prev !== undefined && TERMINAL.has(prev.status)) {
    throw new Error(`refusing to overwrite terminal run ${key} (${prev.status})`);
  }
  state.runs[key] = rec;
}

export interface WorkItem {
  issue: number;
  arms: Arm[];
}

/**
 * Pair scheduler. Partial pairs (one arm terminal, the other not) come first;
 * then up to `batch` fresh pairs. Terminal runs are never rescheduled.
 */
export function nextPairs(state: BenchState, issues: readonly number[], batch: number): WorkItem[] {
  const partial: WorkItem[] = [];
  const freshPairs: WorkItem[] = [];
  for (const issue of issues) {
    const missing = ARMS.filter((a) => {
      const r = state.runs[runKey(issue, a)];
      return r === undefined || !TERMINAL.has(r.status);
    });
    if (missing.length === 0) continue;
    if (missing.length === ARMS.length) freshPairs.push({ issue, arms: [...missing] });
    else partial.push({ issue, arms: [...missing] });
  }
  return [...partial, ...freshPairs.slice(0, batch)];
}
