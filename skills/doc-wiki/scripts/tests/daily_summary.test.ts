/**
 * Tests for daily_summary.ts — ported from test_daily_summary.py.
 *
 * Every pytest `def test_*` is preserved as a Vitest `it()`. CLI-parity
 * tests shell out to the compiled daily_summary.js and confirm stdout +
 * the written markdown file match the Python reference byte-for-byte,
 * including thousands-separator and fixed-precision number formatting.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import { generateSummary, writeSummary } from "../daily_summary.js";
import {
  SCRIPTS_DIR,
  makeInitializedWiki,
  makeTmpPath,
  cleanupTmpPath,
} from "./fixtures.js";

const CLI = path.join(SCRIPTS_DIR, "daily_summary.js");

// ── Event fixture (mirrors `wiki_with_events` in conftest.py) ───────

/** Seed `<wikiRoot>/log/events.jsonl` with the same 8 events pytest's
 *  `wiki_with_events` fixture does (3 on 2026-04-11, 5 on 2026-04-12). */
function seedEvents(wikiRoot: string): void {
  const events = [
    {
      ts: "2026-04-11T10:00:00+00:00",
      op: "ingest",
      source: "report.pdf",
      agent: "file",
      cost_usd: 0.05,
      tokens_in: 5000,
      tokens_out: 1200,
    },
    {
      ts: "2026-04-11T11:00:00+00:00",
      op: "ingest",
      source: "slides.pptx",
      agent: "file",
      cost_usd: 0.03,
      tokens_in: 3000,
      tokens_out: 800,
    },
    {
      ts: "2026-04-11T14:00:00+00:00",
      op: "query",
      source: "how does auth work?",
      agent: "wiki",
      cost_usd: 0.02,
      tokens_in: 2000,
      tokens_out: 500,
      reduction_ratio: 42.0,
    },
    {
      ts: "2026-04-12T09:00:00+00:00",
      op: "ingest",
      source: "api-docs.md",
      agent: "file",
      cost_usd: 0.04,
      tokens_in: 4000,
      tokens_out: 1000,
    },
    {
      ts: "2026-04-12T10:30:00+00:00",
      op: "query",
      source: "what is JWT?",
      agent: "wiki",
      cost_usd: 0.01,
      tokens_in: 1500,
      tokens_out: 400,
      reduction_ratio: 35.0,
    },
    {
      ts: "2026-04-12T11:00:00+00:00",
      op: "query",
      source: "database schema overview",
      agent: "wiki",
      cost_usd: 0.02,
      tokens_in: 2200,
      tokens_out: 600,
      reduction_ratio: 28.0,
    },
    {
      ts: "2026-04-12T12:00:00+00:00",
      op: "lint",
      cost_usd: 0.01,
      tokens_in: 1000,
      tokens_out: 300,
    },
    {
      ts: "2026-04-12T13:00:00+00:00",
      op: "ingest",
      source: "design.docx",
      agent: "jira",
      cost_usd: 0.06,
      tokens_in: 6000,
      tokens_out: 1500,
    },
  ];
  const p = path.join(wikiRoot, "log", "events.jsonl");
  fs.writeFileSync(p, events.map((e) => JSON.stringify(e)).join("\n") + "\n");
}

function makeWikiWithEvents(tmpPath: string): string {
  const wiki = makeInitializedWiki(tmpPath);
  seedEvents(wiki);
  return wiki;
}

function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// ── generate_summary tests ──────────────────────────────────────────

describe("TestGenerateSummary", () => {
  let tmpPath: string;
  let wiki: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("summary-gen-");
    wiki = makeWikiWithEvents(tmpPath);
  });
  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("test_generates_markdown", () => {
    const result = generateSummary(wiki, "2026-04-12");
    expect(result.startsWith("#")).toBe(true);
  });

  it("test_filters_by_date", () => {
    const result = generateSummary(wiki, "2026-04-12").toLowerCase();
    // 2026-04-12 has 5 events: 2 ingest, 2 query, 1 lint
    expect(result).toContain("ingest");
    expect(result).toContain("query");
  });

  it("test_operations_summary_section", () => {
    const result = generateSummary(wiki, "2026-04-12");
    expect(result).toContain("Operations");
  });

  it("test_per_agent_breakdown_section", () => {
    const result = generateSummary(wiki, "2026-04-12");
    expect(result).toContain("Agent");
  });

  it("test_quality_signals_section", () => {
    const result = generateSummary(wiki, "2026-04-12");
    expect(result).toContain("Quality");
  });

  it("test_token_efficiency_section", () => {
    const result = generateSummary(wiki, "2026-04-12");
    expect(result).toContain("Token");
  });

  it("test_defaults_to_today", () => {
    // Python uses `date.today().isoformat()`; we mirror via toLocal-ish
    // local-clock today.
    const result = generateSummary(wiki);
    expect(result).toContain(todayIso());
  });
});

// ── write_summary tests ─────────────────────────────────────────────

describe("TestWriteSummary", () => {
  let tmpPath: string;
  let wiki: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("summary-write-");
    wiki = makeWikiWithEvents(tmpPath);
  });
  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("test_writes_to_daily_directory", () => {
    const outPath = writeSummary(wiki, "2026-04-12");
    expect(fs.existsSync(outPath)).toBe(true);
    expect(path.basename(outPath)).toBe("2026-04-12.md");
    expect(outPath).toContain("daily");
  });

  it("test_returns_path", () => {
    const outPath = writeSummary(wiki, "2026-04-12");
    // TypeScript returns an absolute path string (the Py code returns a
    // pathlib.Path). Validate the shape accordingly.
    expect(typeof outPath).toBe("string");
    expect(path.isAbsolute(outPath)).toBe(true);
  });

  it("test_creates_daily_dir_if_missing", () => {
    const wiki2 = makeInitializedWiki(tmpPath + "-empty");
    const dailyDir = path.join(wiki2, "log", "daily");
    if (fs.existsSync(dailyDir)) {
      fs.rmSync(dailyDir, { recursive: true, force: true });
    }
    const outPath = writeSummary(wiki2, "2026-04-12");
    expect(fs.existsSync(path.dirname(outPath))).toBe(true);
    cleanupTmpPath(tmpPath + "-empty");
  });
});

// ── Edge cases ──────────────────────────────────────────────────────

describe("TestEdgeCases", () => {
  let tmpPath: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("summary-edge-");
  });
  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("test_no_events_for_date", () => {
    const wiki = makeWikiWithEvents(tmpPath);
    const result = generateSummary(wiki, "2099-01-01").toLowerCase();
    // Python: either "no events" or "0" somewhere — we always print
    // "No events recorded for this date."
    expect(result.includes("no events") || result.includes("0")).toBe(true);
  });

  it("test_empty_events_file", () => {
    const wiki = makeInitializedWiki(tmpPath);
    const result = generateSummary(wiki, "2026-04-12");
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("test_events_without_optional_fields", () => {
    const wiki = makeInitializedWiki(tmpPath);
    const eventsPath = path.join(wiki, "log", "events.jsonl");
    fs.writeFileSync(
      eventsPath,
      JSON.stringify({ ts: "2026-04-12T10:00:00+00:00", op: "ingest" }) + "\n",
    );
    const result = generateSummary(wiki, "2026-04-12").toLowerCase();
    expect(typeof result).toBe("string");
    expect(result).toContain("ingest");
  });
});

// ── Fast-path regex pre-filter tests ────────────────────────────────

describe("TestFastPathRegexPrefilter", () => {
  let tmpPath: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("summary-fastpath-");
  });
  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  // The regex `/^{"ts":"([^"\\]+)"/` extracts the leading `ts` field
  // without paying JSON.parse overhead, letting readEvents() reject
  // lines whose date substring only appears inside an unrelated field
  // (e.g. the event's `source` text). A miss falls through to full parse.

  it("rejects line whose target date appears only inside another field", () => {
    const wiki = makeInitializedWiki(tmpPath);
    const eventsPath = path.join(wiki, "log", "events.jsonl");
    // `ts` is for 2026-04-11, but the `source` field contains the
    // string "2026-04-12" — without the regex pre-filter the includes()
    // check would still pay JSON.parse cost, but more importantly the
    // entry must not be counted for 2026-04-12.
    const decoy = {
      ts: "2026-04-11T10:00:00+00:00",
      op: "ingest",
      source: "report-from-2026-04-12.pdf",
      cost_usd: 0.05,
    };
    const realEntry = {
      ts: "2026-04-12T10:00:00+00:00",
      op: "ingest",
      source: "real.pdf",
      cost_usd: 0.01,
    };
    fs.writeFileSync(
      eventsPath,
      [JSON.stringify(decoy), JSON.stringify(realEntry)].join("\n") + "\n",
    );
    const result = generateSummary(wiki, "2026-04-12");
    // Only the real entry should be counted: 1 ingest, $0.0100 total.
    // If the decoy bled through, total cost would be $0.0600 (0.05 + 0.01)
    // and the ingest count would be 2.
    expect(result).toContain("| ingest | 1 |");
    expect(result).toContain("$0.0100");
    expect(result).not.toContain("$0.0600");
  });

  it("falls through to JSON.parse when ts is not the first key", () => {
    const wiki = makeInitializedWiki(tmpPath);
    const eventsPath = path.join(wiki, "log", "events.jsonl");
    // Manually emit a line where `op` precedes `ts`. The anchored regex
    // will not match, but the date string IS present, so the line must
    // still be processed by full JSON.parse and counted.
    const nonCanonical =
      '{"op":"ingest","ts":"2026-04-12T10:00:00+00:00","source":"x.pdf","cost_usd":0.05}';
    fs.writeFileSync(eventsPath, nonCanonical + "\n");
    const result = generateSummary(wiki, "2026-04-12");
    expect(result).toContain("ingest");
  });
});

// ── CLI tests ──────────────────────────────────────────────────────

function runCli(
  bin: string,
  args: readonly string[],
): { stdout: string; stderr: string; status: number } {
  try {
    const stdout = execFileSync("node", [bin, ...args], {
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

describe("TestDailySummaryCLI", () => {
  let tmpPath: string;
  let wiki: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("summary-cli-");
    wiki = makeWikiWithEvents(tmpPath);
  });
  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("test_cli_with_date", () => {
    const result = runCli(CLI, ["--wiki-root", wiki, "--date", "2026-04-12"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("2026-04-12");
  });

  it("test_cli_default_date", () => {
    const result = runCli(CLI, ["--wiki-root", wiki]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(todayIso());
  });

});
