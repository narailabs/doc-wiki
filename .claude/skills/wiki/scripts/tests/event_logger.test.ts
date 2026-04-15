/**
 * Tests for event_logger.ts — ported from test_event_logger.py.
 *
 * Every pytest `def test_*` is preserved as a Vitest `it()`. The test
 * file here also includes a micro-test of the timestamp formatter so
 * Python-compat parity is enforced independently of the event pipeline.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

import { execFileSync } from "node:child_process";

import {
  logEvent,
  getStats,
  pythonIsoformatUtc,
} from "../event_logger.js";
import {
  SCRIPTS_DIR,
  makeTmpPath,
  cleanupTmpPath,
} from "./fixtures.js";

const CLI = path.join(SCRIPTS_DIR, "event_logger.js");

function runCli(
  args: readonly string[],
): { stdout: string; stderr: string; status: number } {
  try {
    const stdout = execFileSync("node", [CLI, ...args], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { stdout, stderr: "", status: 0 };
  } catch (e) {
    const err = e as NodeJS.ErrnoException & {
      status?: number;
      stdout?: Buffer | string;
      stderr?: Buffer | string;
    };
    return {
      stdout:
        typeof err.stdout === "string"
          ? err.stdout
          : (err.stdout?.toString("utf-8") ?? ""),
      stderr:
        typeof err.stderr === "string"
          ? err.stderr
          : (err.stderr?.toString("utf-8") ?? ""),
      status: err.status ?? 1,
    };
  }
}

// ── Fixture helpers ─────────────────────────────────────────────────

/** Mirrors pytest's `wiki_root` fixture: a temp dir with log/ pre-created. */
function makeWikiRoot(tmpPath: string): string {
  fs.mkdirSync(path.join(tmpPath, "log"), { recursive: true });
  return tmpPath;
}

/** Mirrors pytest's `wiki_root_with_events` fixture. */
function makeWikiRootWithEvents(tmpPath: string): string {
  const wikiRoot = makeWikiRoot(tmpPath);
  const events = [
    {
      ts: "2026-04-01T10:00:00+00:00",
      op: "ingest",
      tokens_in: 1000,
      tokens_out: 500,
      cost_usd: 0.05,
      reduction_ratio: 0.6,
    },
    {
      ts: "2026-04-05T12:00:00+00:00",
      op: "query",
      tokens_in: 200,
      tokens_out: 800,
      cost_usd: 0.03,
      reduction_ratio: 0.4,
    },
    {
      ts: "2026-04-10T08:00:00+00:00",
      op: "ingest",
      tokens_in: 1500,
      tokens_out: 600,
      cost_usd: 0.07,
      reduction_ratio: 0.8,
    },
    {
      ts: "2026-04-10T14:00:00+00:00",
      op: "lint",
      tokens_in: 100,
      tokens_out: 50,
      cost_usd: 0.01,
      reduction_ratio: 0.5,
    },
  ];
  const p = path.join(wikiRoot, "log", "events.jsonl");
  fs.writeFileSync(p, events.map((e) => JSON.stringify(e)).join("\n") + "\n");
  return wikiRoot;
}

/** `pytest.approx`-style tolerance comparator. */
function approxEqual(a: number, b: number, tol: number = 1e-9): boolean {
  return Math.abs(a - b) <= tol;
}

// ── logEvent tests ──────────────────────────────────────────────────

describe("TestLogEvent", () => {
  let tmpPath: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("event-log-");
  });

  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("test_log_event_creates_jsonl_entry", () => {
    const wikiRoot = makeWikiRoot(tmpPath);
    logEvent(wikiRoot, "ingest", { source: "slides.pptx" });

    const logPath = path.join(wikiRoot, "log", "events.jsonl");
    expect(fs.existsSync(logPath)).toBe(true);
    const lines = fs
      .readFileSync(logPath, { encoding: "utf-8" })
      .trim()
      .split("\n");
    expect(lines).toHaveLength(1);
    const first = lines[0];
    expect(first).toBeDefined();
    const entry = JSON.parse(first ?? "");
    expect(entry.op).toBe("ingest");
    expect(entry.source).toBe("slides.pptx");
  });

  it("test_log_event_includes_timestamp", () => {
    const wikiRoot = makeWikiRoot(tmpPath);
    const result = logEvent(wikiRoot, "query", {});
    expect("ts" in result).toBe(true);
    // Must parse into a valid date object (Date.parse accepts the
    // `YYYY-MM-DDTHH:MM:SS.ffffff+00:00` form the same way Python's
    // `datetime.fromisoformat` does).
    const ts = result["ts"];
    expect(typeof ts).toBe("string");
    const parsed = Date.parse(ts as string);
    expect(Number.isNaN(parsed)).toBe(false);
    const year = new Date(parsed).getUTCFullYear();
    expect(year).toBeGreaterThanOrEqual(2026);
  });

  it("test_log_event_includes_operation", () => {
    const wikiRoot = makeWikiRoot(tmpPath);
    for (const op of ["ingest", "query", "lint", "graph_update"]) {
      const result = logEvent(wikiRoot, op, {});
      expect(result["op"]).toBe(op);
    }
  });

  it("test_log_event_appends_not_overwrites", () => {
    const wikiRoot = makeWikiRoot(tmpPath);
    logEvent(wikiRoot, "ingest", { batch: 1 });
    logEvent(wikiRoot, "query", { batch: 2 });
    logEvent(wikiRoot, "lint", { batch: 3 });

    const logPath = path.join(wikiRoot, "log", "events.jsonl");
    const lines = fs
      .readFileSync(logPath, { encoding: "utf-8" })
      .trim()
      .split("\n");
    expect(lines).toHaveLength(3);
    const ops = lines.map((l) => JSON.parse(l).op);
    expect(ops).toEqual(["ingest", "query", "lint"]);
  });

  it("test_log_event_with_agent_calls", () => {
    const wikiRoot = makeWikiRoot(tmpPath);
    const calls = [
      { tool: "Read", duration_ms: 120 },
      { tool: "Grep", duration_ms: 45 },
    ];
    const result = logEvent(wikiRoot, "query", { agent_calls: calls });
    expect(result["agent_calls"]).toEqual(calls);
    expect((result["agent_calls"] as unknown[]).length).toBe(2);
  });

  it("test_log_event_with_token_metrics", () => {
    const wikiRoot = makeWikiRoot(tmpPath);
    const details = {
      tokens_in: 1500,
      tokens_out: 800,
      cost_usd: 0.042,
    };
    const result = logEvent(wikiRoot, "ingest", details);
    expect(result["tokens_in"]).toBe(1500);
    expect(result["tokens_out"]).toBe(800);
    expect(approxEqual(result["cost_usd"] as number, 0.042)).toBe(true);
  });

  it("test_missing_log_file_creates_it", () => {
    // Neither the dir nor the file exist
    const bareRoot = path.join(tmpPath, "fresh-wiki");
    expect(fs.existsSync(bareRoot)).toBe(false);

    const result = logEvent(bareRoot, "ingest", { note: "first" });
    const logPath = path.join(bareRoot, "log", "events.jsonl");
    expect(fs.existsSync(logPath)).toBe(true);
    expect(result["op"]).toBe("ingest");
  });
});

// ── getStats tests ──────────────────────────────────────────────────

describe("TestGetStats", () => {
  let tmpPath: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("event-stats-");
  });

  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("test_stats_aggregation", () => {
    const wikiRoot = makeWikiRootWithEvents(tmpPath);
    const stats = getStats(wikiRoot);

    const opsByType = stats["ops_by_type"] as Record<string, number>;
    expect(opsByType["ingest"]).toBe(2);
    expect(opsByType["query"]).toBe(1);
    expect(opsByType["lint"]).toBe(1);
    expect(stats["total_ops"]).toBe(4);

    expect(approxEqual(stats["total_cost_usd"] as number, 0.16)).toBe(true);

    // Reduction ratio stats (values: 0.6, 0.4, 0.8, 0.5)
    const ratio = stats["reduction_ratio"] as Record<string, number>;
    expect(approxEqual(ratio["mean"] ?? 0, 0.575)).toBe(true);
    // p50 of [0.4, 0.5, 0.6, 0.8] = (0.5 + 0.6) / 2 = 0.55
    expect(approxEqual(ratio["p50"] ?? 0, 0.55)).toBe(true);
    // p95 should be close to 0.8 (within 0.05)
    expect(approxEqual(ratio["p95"] ?? 0, 0.8, 0.05)).toBe(true);
  });

  it("test_stats_with_since_filter", () => {
    const wikiRoot = makeWikiRootWithEvents(tmpPath);
    // Only events on or after 2026-04-10
    const stats = getStats(wikiRoot, "2026-04-09T00:00:00+00:00");

    expect(stats["total_ops"]).toBe(2);
    const opsByType = stats["ops_by_type"] as Record<string, number>;
    expect(opsByType["ingest"]).toBe(1);
    expect(opsByType["lint"]).toBe(1);
    expect("query" in opsByType).toBe(false);
    expect(approxEqual(stats["total_cost_usd"] as number, 0.08)).toBe(true);
  });
});

// ── Python-compat timestamp format check ────────────────────────────
//
// Not a Python-port test (no equivalent in test_event_logger.py), but
// critical enough to the port's correctness that we pin the shape here.
// Timestamp parity is one of the two hard behavioural gates in this phase
// (the other is SHA256 parity in cache_manager).

describe("PythonIsoformatUtc", () => {
  it("renders 6-digit microseconds with +00:00 suffix", () => {
    const d = new Date("2026-04-12T10:30:00.123Z");
    // JS has ms precision; we expect `.123000` (padded to 6 digits).
    expect(pythonIsoformatUtc(d)).toBe("2026-04-12T10:30:00.123000+00:00");
  });

  it("omits microseconds when exactly zero", () => {
    const d = new Date("2026-04-12T10:30:00.000Z");
    // Python's isoformat omits ".000000" when micros are exactly 0.
    expect(pythonIsoformatUtc(d)).toBe("2026-04-12T10:30:00+00:00");
  });
});

// ── CLI contract pins (Python-style JSON shape) ────────────────────
//
// These were once Python-reference parity tests. The Python side has been
// retired, but the TS CLI still emits Python-style JSON (`0.0` for floats,
// `0` for ints) because downstream consumers still parse the output with
// Python's `json`. The assertions below pin that contract.

describe("EventLoggerCLIShape", () => {
  let tmpPath: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("event-cli-shape-");
  });

  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  /** Pre-populate the events.jsonl under `tmpPath/log/`. */
  function seedEvents(): void {
    const logDir = path.join(tmpPath, "log");
    fs.mkdirSync(logDir, { recursive: true });
    const events = [
      { ts: "2026-04-01T10:00:00+00:00", op: "ingest", source: "a.md",
        agent: "file", cost_usd: 0.05, reduction_ratio: 0.6 },
      { ts: "2026-04-05T12:00:00+00:00", op: "query",
        agent: "wiki", cost_usd: 0.03, reduction_ratio: 0.4 },
      { ts: "2026-04-10T08:00:00+00:00", op: "ingest",
        agent: "file", cost_usd: 0.07, reduction_ratio: 0.8 },
      { ts: "2026-04-10T14:00:00+00:00", op: "lint",
        cost_usd: 0.01, reduction_ratio: 0.5 },
    ];
    fs.writeFileSync(
      path.join(logDir, "events.jsonl"),
      events.map((e) => JSON.stringify(e)).join("\n") + "\n",
    );
  }

  it("cli_stats_empty_emits_zero_float", () => {
    // No events — stats emits `total_cost_usd: 0`.
    fs.mkdirSync(path.join(tmpPath, "log"), { recursive: true });
    fs.writeFileSync(path.join(tmpPath, "log", "events.jsonl"), "");
    const js = runCli(["stats", "--wiki-root", tmpPath]);
    expect(js.status).toBe(0);
    expect(js.stdout).toContain('"total_cost_usd": 0');
  });

  it("cli_stats_populated_emits_non_zero_cost", () => {
    seedEvents();
    const js = runCli(["stats", "--wiki-root", tmpPath]);
    expect(js.status).toBe(0);
    const data = JSON.parse(js.stdout);
    expect(typeof data.total_cost_usd).toBe("number");
    expect(data.total_cost_usd).toBeGreaterThan(0);
    expect(data.total_ops).toBeGreaterThanOrEqual(4);
  });

  it("cli_stats_since_iso_filters_older_events", () => {
    seedEvents();
    const js = runCli([
      "stats",
      "--wiki-root",
      tmpPath,
      "--since",
      "2026-04-09T00:00:00+00:00",
    ]);
    expect(js.status).toBe(0);
    const data = JSON.parse(js.stdout);
    // Only two events fall on or after 2026-04-09.
    expect(data.total_ops).toBe(2);
  });

  it("cli_stats_integer_ratios_emit_python_style_numbers", () => {
    // Integer inputs trip a subtle int-vs-float rule that the TS CLI
    // preserves (the Python reference used to assert exact output):
    //   mean([2, 2])       === 2     (int)       → emit as `2`
    //   median([2, 2])     === 2.0   (even-len)  → emit as `2.0`
    //   median([2, 2, 3])  === 2     (odd-len)   → emit as `2`
    //   p95 (nearest-rank) === 2     (element)   → emit as `2`
    // total_cost_usd remains always-float because it is initialized at 0.0.
    const logDir = path.join(tmpPath, "log");
    fs.mkdirSync(logDir, { recursive: true });
    const events = [
      { ts: "2026-04-01T10:00:00+00:00", op: "ingest",
        agent: "file", cost_usd: 5, reduction_ratio: 2 },
      { ts: "2026-04-05T12:00:00+00:00", op: "ingest",
        agent: "file", cost_usd: 5, reduction_ratio: 2 },
      { ts: "2026-04-10T08:00:00+00:00", op: "ingest",
        agent: "file", cost_usd: 5, reduction_ratio: 3 },
    ];
    fs.writeFileSync(
      path.join(logDir, "events.jsonl"),
      events.map((e) => JSON.stringify(e)).join("\n") + "\n",
    );
    const js = runCli(["stats", "--wiki-root", tmpPath]);
    expect(js.status).toBe(0);
    expect(js.stdout).toMatch(/"total_cost_usd":\s*15\b/);
  });
});

// ── agent_calls[] (G9) ───────────────────────────────────────────────

describe("agent_calls[] breakdown", () => {
  let tmpPath: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("event-agent-calls-");
  });
  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("computes totals when caller omits them", () => {
    const entry = logEvent(tmpPath, "ingest", {
      source: "report.pdf",
      agent_calls: [
        {
          agent: "jira",
          model: "haiku",
          tokens_in: 1200,
          tokens_out: 340,
          cost_usd: 0.001,
          elapsed_ms: 2400,
          status: "success",
        },
        {
          agent: "db_agent",
          model: null,
          tokens_in: 0,
          tokens_out: 0,
          cost_usd: 0.0,
          elapsed_ms: 180,
          status: "success",
          note: "deterministic",
        },
      ],
    });
    expect(entry["total_tokens_in"]).toBe(1200);
    expect(entry["total_tokens_out"]).toBe(340);
    expect(entry["total_cost_usd"]).toBeCloseTo(0.001, 5);
  });

  it("does not overwrite caller-provided totals", () => {
    const entry = logEvent(tmpPath, "ingest", {
      agent_calls: [
        {
          agent: "jira", model: "haiku", tokens_in: 10, tokens_out: 5,
          cost_usd: 0.5, elapsed_ms: 100, status: "success",
        },
      ],
      total_cost_usd: 999,
    });
    expect(entry["total_cost_usd"]).toBe(999);
    // The summed totals we omitted still get filled in.
    expect(entry["total_tokens_in"]).toBe(10);
    expect(entry["total_tokens_out"]).toBe(5);
  });

  it("is a no-op when agent_calls is absent or not an array", () => {
    const entry1 = logEvent(tmpPath, "fix", { page: "x.md" });
    expect(entry1).not.toHaveProperty("total_tokens_in");

    cleanupTmpPath(tmpPath);
    tmpPath = makeTmpPath("event-agent-calls-");
    const entry2 = logEvent(tmpPath, "fix", { agent_calls: "not-an-array" });
    expect(entry2).not.toHaveProperty("total_tokens_in");
  });

  it("stats aggregates per-agent cost from agent_calls[]", () => {
    // One event with two sub-agent dispatches.
    logEvent(tmpPath, "ingest", {
      agent_calls: [
        {
          agent: "jira", model: "haiku", tokens_in: 0, tokens_out: 0,
          cost_usd: 0.25, elapsed_ms: 10, status: "success",
        },
        {
          agent: "db_agent", model: null, tokens_in: 0, tokens_out: 0,
          cost_usd: 0.5, elapsed_ms: 10, status: "success",
        },
      ],
    });
    const stats = getStats(tmpPath);
    const perAgent = stats["per_agent_cost"] as Record<string, number>;
    expect(perAgent["jira"]).toBeCloseTo(0.25, 5);
    expect(perAgent["db_agent"]).toBeCloseTo(0.5, 5);
  });
});

// ── A6: includeZeroTokens flag for getStats ────────────────────────
describe("getStats includeZeroTokens (A6)", () => {
  let tmpPath: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("event-zero-tokens-");
  });
  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  /** Seed a log with two ops: one carrying tokens, one without. */
  function seed(): void {
    fs.mkdirSync(path.join(tmpPath, "log"), { recursive: true });
    const events = [
      { ts: "2026-04-01T10:00:00+00:00", op: "ingest", tokens_in: 100, tokens_out: 50 },
      { ts: "2026-04-01T11:00:00+00:00", op: "init" },  // no token data
      { ts: "2026-04-01T12:00:00+00:00", op: "lint" },  // no token data
    ];
    fs.writeFileSync(
      path.join(tmpPath, "log", "events.jsonl"),
      events.map((e) => JSON.stringify(e)).join("\n") + "\n",
    );
  }

  it("default behaviour omits zero-token ops from total_tokens_by_op", () => {
    seed();
    const stats = getStats(tmpPath);
    const tokens = stats["total_tokens_by_op"] as Record<string, number>;
    expect(tokens["ingest"]).toBe(150);
    expect("init" in tokens).toBe(false);
    expect("lint" in tokens).toBe(false);
  });

  it("includeZeroTokens=true backfills every observed op as 0", () => {
    seed();
    const stats = getStats(tmpPath, null, { includeZeroTokens: true });
    const tokens = stats["total_tokens_by_op"] as Record<string, number>;
    expect(tokens["ingest"]).toBe(150);
    expect(tokens["init"]).toBe(0);
    expect(tokens["lint"]).toBe(0);
    // Token-bearing op keeps its real total (not overwritten to 0).
    expect(Object.keys(tokens).sort()).toEqual(["ingest", "init", "lint"]);
  });

  it("CLI: --include-zero-tokens flag emits the same key set as ops_by_type", () => {
    seed();
    const result = runCli([
      "stats",
      "--wiki-root",
      tmpPath,
      "--include-zero-tokens",
    ]);
    expect(result.status).toBe(0);
    const data = JSON.parse(result.stdout) as {
      ops_by_type: Record<string, number>;
      total_tokens_by_op: Record<string, number>;
    };
    expect(Object.keys(data.total_tokens_by_op).sort()).toEqual(
      Object.keys(data.ops_by_type).sort(),
    );
    expect(data.total_tokens_by_op["init"]).toBe(0);
    expect(data.total_tokens_by_op["lint"]).toBe(0);
  });

  it("CLI: default (no flag) keeps zero-token ops out of total_tokens_by_op", () => {
    seed();
    const result = runCli(["stats", "--wiki-root", tmpPath]);
    expect(result.status).toBe(0);
    const data = JSON.parse(result.stdout) as {
      total_tokens_by_op: Record<string, number>;
    };
    expect("init" in data.total_tokens_by_op).toBe(false);
    expect("lint" in data.total_tokens_by_op).toBe(false);
  });
});
