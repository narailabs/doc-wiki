import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
const TERMINAL = new Set(["passed", "failed"]);
const TRANSIENT = new Set(["running", "error", "rate-limited"]);
/** Arms that must not be (re-)scheduled: terminal, plus `ran` (session done, grade pending — re-running would burn a paid session and overwrite artifacts). */
const SCHEDULING_DONE = new Set(["passed", "failed", "ran"]);
const ARMS = ["baseline", "wiki"];
export const runKey = (issue, arm) => `${issue}:${arm}`;
/** Load (or initialize) state; transient statuses revert to pending so resume re-queues them. `ran` survives — it resumes as grade-only. */
export function loadState(file, repo) {
    if (!existsSync(file))
        return { schema_version: 1, repo, runs: {} };
    let state;
    try {
        state = JSON.parse(readFileSync(file, "utf8"));
    }
    catch (e) {
        throw new Error(`corrupt checkpoint ${file}: ${e}`);
    }
    if (state.repo !== repo) {
        throw new Error(`checkpoint ${file} belongs to repo "${state.repo}", not "${repo}"`);
    }
    for (const rec of Object.values(state.runs)) {
        if (TRANSIENT.has(rec.status))
            rec.status = "pending";
    }
    return state;
}
/** Atomic write: tmp file + rename. */
export function saveState(file, state) {
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`);
    renameSync(tmp, file);
}
/**
 * Guarded status write. Refuses to overwrite terminal and `ran` records.
 * NOTE: the grading pass transitions ran→passed/failed by assigning
 * `rec.status` directly on the loaded state object, not via setRun.
 */
export function setRun(state, issue, arm, rec) {
    const key = runKey(issue, arm);
    const prev = state.runs[key];
    if (prev !== undefined && (TERMINAL.has(prev.status) || prev.status === "ran")) {
        throw new Error(`refusing to overwrite terminal/ran run ${key} (${prev.status})`);
    }
    state.runs[key] = rec;
}
/**
 * Pair scheduler. Partial pairs (one arm done, the other not) come first;
 * then up to `batch` fresh pairs. Terminal and `ran` arms are never
 * rescheduled — `ran` resumes as grade-only, not a new session.
 */
export function nextPairs(state, issues, batch) {
    const partial = [];
    const freshPairs = [];
    for (const issue of issues) {
        const missing = ARMS.filter((a) => {
            const r = state.runs[runKey(issue, a)];
            return r === undefined || !SCHEDULING_DONE.has(r.status);
        });
        if (missing.length === 0)
            continue;
        if (missing.length === ARMS.length)
            freshPairs.push({ issue, arms: [...missing] });
        else
            partial.push({ issue, arms: [...missing] });
    }
    return [...partial, ...freshPairs.slice(0, batch)];
}
