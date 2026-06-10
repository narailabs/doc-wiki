import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadState, nextPairs, runKey, saveState, setRun } from "../bench_checkpoint.js";
import type { BenchState } from "../types.js";

const fresh = (): BenchState => ({ schema_version: 1, repo: "demo", runs: {} });

describe("checkpoint state machine", () => {
  it("round-trips through disk and reverts transient states to pending", () => {
    const dir = mkdtempSync(join(tmpdir(), "benchst-"));
    const file = join(dir, "state.json");
    const s = fresh();
    setRun(s, 1, "baseline", { status: "running" });
    setRun(s, 1, "wiki", { status: "error", detail: "container crashed" });
    setRun(s, 2, "baseline", { status: "rate-limited" });
    setRun(s, 2, "wiki", { status: "passed" });
    saveState(file, s);
    const loaded = loadState(file, "demo");
    expect(loaded.runs[runKey(1, "baseline")]?.status).toBe("pending");
    expect(loaded.runs[runKey(1, "wiki")]?.status).toBe("pending");
    expect(loaded.runs[runKey(2, "baseline")]?.status).toBe("pending");
    expect(loaded.runs[runKey(2, "wiki")]?.status).toBe("passed"); // terminal survives
  });

  it("refuses to load a checkpoint for a different repo", () => {
    const dir = mkdtempSync(join(tmpdir(), "benchst-"));
    const file = join(dir, "state.json");
    saveState(file, fresh());
    expect(() => loadState(file, "other")).toThrow(/other/);
  });

  it("never overwrites a terminal run", () => {
    const s = fresh();
    setRun(s, 1, "wiki", { status: "passed" });
    expect(() => setRun(s, 1, "wiki", { status: "running" })).toThrow(/terminal/);
  });

  it("schedules partial pairs before fresh pairs, and batch counts fresh pairs only", () => {
    const s = fresh();
    // ticket 5: baseline done, wiki missing -> partial
    setRun(s, 5, "baseline", { status: "passed" });
    const work = nextPairs(s, [3, 5, 7, 9], 2);
    expect(work[0]).toEqual({ issue: 5, arms: ["wiki"] });
    // batch=2 fresh pairs follow
    expect(work.slice(1)).toEqual([
      { issue: 3, arms: ["baseline", "wiki"] },
      { issue: 7, arms: ["baseline", "wiki"] },
    ]);
  });

  it("skips fully-terminal tickets", () => {
    const s = fresh();
    setRun(s, 3, "baseline", { status: "passed" });
    setRun(s, 3, "wiki", { status: "failed" });
    expect(nextPairs(s, [3], 5)).toEqual([]);
  });

  it("ran survives loadState unchanged", () => {
    const dir = mkdtempSync(join(tmpdir(), "benchst-"));
    const file = join(dir, "state.json");
    const s = fresh();
    setRun(s, 1, "baseline", { status: "ran" });
    saveState(file, s);
    const loaded = loadState(file, "demo");
    expect(loaded.runs[runKey(1, "baseline")]?.status).toBe("ran");
  });

  it("treats a (ran, pending) pair as partial and never re-schedules ran arms", () => {
    const s = fresh();
    setRun(s, 5, "baseline", { status: "ran" });
    const work = nextPairs(s, [3, 5], 1);
    expect(work[0]).toEqual({ issue: 5, arms: ["wiki"] });
    expect(work.slice(1)).toEqual([{ issue: 3, arms: ["baseline", "wiki"] }]);
    // fully-ran ticket: nothing to schedule
    const t = fresh();
    setRun(t, 9, "baseline", { status: "ran" });
    setRun(t, 9, "wiki", { status: "ran" });
    expect(nextPairs(t, [9], 5)).toEqual([]);
  });

  it("never overwrites a ran run", () => {
    const s = fresh();
    setRun(s, 1, "wiki", { status: "ran" });
    expect(() => setRun(s, 1, "wiki", { status: "running" })).toThrow(/terminal|ran/);
  });
});
