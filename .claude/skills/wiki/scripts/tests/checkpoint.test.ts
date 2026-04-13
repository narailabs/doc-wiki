/**
 * Tests for checkpoint.ts — the resume mechanism used by long-running
 * batch flows (`/wiki-ingest` on a folder, `/wiki-refresh` across many
 * sources).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  CHECKPOINT_FILENAME,
  readCheckpoint,
  writeCheckpoint,
  clearCheckpoint,
  recordUnit,
} from "../checkpoint.js";
import { makeTmpPath, cleanupTmpPath } from "./fixtures.js";

describe("readCheckpoint", () => {
  let tmpPath: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("checkpoint-read-");
  });

  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("returns null when the file does not exist", () => {
    expect(readCheckpoint(tmpPath, "ingest:abc")).toBeNull();
  });

  it("returns null when the op is not in the file", () => {
    writeCheckpoint(tmpPath, "other-op", { completedIds: ["x"] });
    expect(readCheckpoint(tmpPath, "ingest:abc")).toBeNull();
  });

  it("returns null for a malformed file", () => {
    fs.writeFileSync(path.join(tmpPath, CHECKPOINT_FILENAME), "not json{{{");
    expect(readCheckpoint(tmpPath, "ingest:abc")).toBeNull();
  });
});

describe("writeCheckpoint + readCheckpoint round-trip", () => {
  let tmpPath: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("checkpoint-roundtrip-");
  });

  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("persists completedIds exactly", () => {
    writeCheckpoint(tmpPath, "ingest:folder", {
      completedIds: ["a.md", "b.md", "c.md"],
    });
    const got = readCheckpoint(tmpPath, "ingest:folder");
    expect(got).not.toBeNull();
    expect(got?.completedIds).toEqual(["a.md", "b.md", "c.md"]);
  });

  it("assigns startedAt automatically on first write", () => {
    writeCheckpoint(tmpPath, "ingest:folder", { completedIds: [] });
    const got = readCheckpoint(tmpPath, "ingest:folder");
    expect(got?.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("preserves startedAt across subsequent writes", () => {
    writeCheckpoint(tmpPath, "ingest:folder", { completedIds: ["a"] });
    const first = readCheckpoint(tmpPath, "ingest:folder");
    const originalStartedAt = first?.startedAt;

    writeCheckpoint(tmpPath, "ingest:folder", {
      completedIds: ["a", "b"],
    });
    const second = readCheckpoint(tmpPath, "ingest:folder");
    expect(second?.startedAt).toBe(originalStartedAt);
  });

  it("updates lastUpdateAt on every write", async () => {
    writeCheckpoint(tmpPath, "ingest:folder", { completedIds: ["a"] });
    const first = readCheckpoint(tmpPath, "ingest:folder");

    // Give the clock a small nudge so the two timestamps differ.
    await new Promise((r) => setTimeout(r, 5));

    writeCheckpoint(tmpPath, "ingest:folder", { completedIds: ["a", "b"] });
    const second = readCheckpoint(tmpPath, "ingest:folder");

    expect(second?.lastUpdateAt).not.toBe(first?.lastUpdateAt);
  });

  it("accepts an explicit startedAt override", () => {
    const fixed = "2026-04-01T00:00:00.000Z";
    writeCheckpoint(tmpPath, "ingest:folder", {
      completedIds: [],
      startedAt: fixed,
    });
    expect(readCheckpoint(tmpPath, "ingest:folder")?.startedAt).toBe(fixed);
  });
});

describe("multi-op isolation", () => {
  let tmpPath: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("checkpoint-multi-");
  });

  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("multiple opNames in the same file do not overwrite each other", () => {
    writeCheckpoint(tmpPath, "ingest:folder-1", { completedIds: ["a", "b"] });
    writeCheckpoint(tmpPath, "refresh:all", { completedIds: ["x", "y", "z"] });
    writeCheckpoint(tmpPath, "ingest:folder-2", { completedIds: ["m"] });

    expect(readCheckpoint(tmpPath, "ingest:folder-1")?.completedIds).toEqual([
      "a",
      "b",
    ]);
    expect(readCheckpoint(tmpPath, "refresh:all")?.completedIds).toEqual([
      "x",
      "y",
      "z",
    ]);
    expect(readCheckpoint(tmpPath, "ingest:folder-2")?.completedIds).toEqual([
      "m",
    ]);

    // Single file on disk holds all three.
    const raw = fs.readFileSync(
      path.join(tmpPath, CHECKPOINT_FILENAME),
      "utf-8",
    );
    const parsed = JSON.parse(raw);
    expect(Object.keys(parsed).sort()).toEqual([
      "ingest:folder-1",
      "ingest:folder-2",
      "refresh:all",
    ]);
  });

  it("updates to one op leave the others unchanged", () => {
    writeCheckpoint(tmpPath, "op-a", { completedIds: ["1", "2"] });
    writeCheckpoint(tmpPath, "op-b", { completedIds: ["x"] });

    writeCheckpoint(tmpPath, "op-a", { completedIds: ["1", "2", "3"] });

    expect(readCheckpoint(tmpPath, "op-b")?.completedIds).toEqual(["x"]);
    expect(readCheckpoint(tmpPath, "op-a")?.completedIds).toEqual([
      "1",
      "2",
      "3",
    ]);
  });
});

describe("clearCheckpoint", () => {
  let tmpPath: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("checkpoint-clear-");
  });

  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("removes only the specified opName entry", () => {
    writeCheckpoint(tmpPath, "op-a", { completedIds: ["1"] });
    writeCheckpoint(tmpPath, "op-b", { completedIds: ["2"] });

    clearCheckpoint(tmpPath, "op-a");

    expect(readCheckpoint(tmpPath, "op-a")).toBeNull();
    expect(readCheckpoint(tmpPath, "op-b")?.completedIds).toEqual(["2"]);
  });

  it("deletes the file when it was the only opName", () => {
    writeCheckpoint(tmpPath, "op-only", { completedIds: ["1", "2"] });
    const filePath = path.join(tmpPath, CHECKPOINT_FILENAME);
    expect(fs.existsSync(filePath)).toBe(true);

    clearCheckpoint(tmpPath, "op-only");

    expect(fs.existsSync(filePath)).toBe(false);
  });

  it("is a no-op when the file is missing", () => {
    expect(() => clearCheckpoint(tmpPath, "never-existed")).not.toThrow();
  });

  it("is a no-op when the opName is missing", () => {
    writeCheckpoint(tmpPath, "op-a", { completedIds: ["1"] });
    clearCheckpoint(tmpPath, "op-b");
    expect(readCheckpoint(tmpPath, "op-a")?.completedIds).toEqual(["1"]);
  });
});

describe("atomic rename safety", () => {
  let tmpPath: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("checkpoint-atomic-");
  });

  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("leaves no .tmp files behind after a successful write", () => {
    writeCheckpoint(tmpPath, "op-a", { completedIds: ["1"] });
    writeCheckpoint(tmpPath, "op-b", { completedIds: ["2"] });
    writeCheckpoint(tmpPath, "op-a", { completedIds: ["1", "2"] });

    const leftover = fs
      .readdirSync(tmpPath)
      .filter((f) => f.endsWith(".tmp"));
    expect(leftover).toEqual([]);
  });

  it("leaves no .tmp files behind after clearCheckpoint", () => {
    writeCheckpoint(tmpPath, "op-a", { completedIds: ["1"] });
    writeCheckpoint(tmpPath, "op-b", { completedIds: ["2"] });
    clearCheckpoint(tmpPath, "op-a");

    const leftover = fs
      .readdirSync(tmpPath)
      .filter((f) => f.endsWith(".tmp"));
    expect(leftover).toEqual([]);
  });
});

describe("recordUnit", () => {
  let tmpPath: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("checkpoint-record-");
  });

  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("creates the op entry on first call", () => {
    recordUnit(tmpPath, "ingest:folder", "a.md");
    expect(readCheckpoint(tmpPath, "ingest:folder")?.completedIds).toEqual([
      "a.md",
    ]);
  });

  it("appends subsequent units in order", () => {
    recordUnit(tmpPath, "ingest:folder", "a.md");
    recordUnit(tmpPath, "ingest:folder", "b.md");
    recordUnit(tmpPath, "ingest:folder", "c.md");
    expect(readCheckpoint(tmpPath, "ingest:folder")?.completedIds).toEqual([
      "a.md",
      "b.md",
      "c.md",
    ]);
  });

  it("is idempotent: recording the same unit twice does not duplicate", () => {
    recordUnit(tmpPath, "ingest:folder", "a.md");
    recordUnit(tmpPath, "ingest:folder", "b.md");
    recordUnit(tmpPath, "ingest:folder", "a.md");
    recordUnit(tmpPath, "ingest:folder", "b.md");

    expect(readCheckpoint(tmpPath, "ingest:folder")?.completedIds).toEqual([
      "a.md",
      "b.md",
    ]);
  });

  it("does not disturb other opName entries", () => {
    writeCheckpoint(tmpPath, "other-op", { completedIds: ["x"] });
    recordUnit(tmpPath, "ingest:folder", "a.md");

    expect(readCheckpoint(tmpPath, "other-op")?.completedIds).toEqual(["x"]);
    expect(readCheckpoint(tmpPath, "ingest:folder")?.completedIds).toEqual([
      "a.md",
    ]);
  });
});

describe("resume correctness", () => {
  let tmpPath: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("checkpoint-resume-");
  });

  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("caller can skip completed units when resuming", () => {
    // Simulate an earlier run that processed A and B before crashing.
    writeCheckpoint(tmpPath, "ingest:folder", {
      completedIds: ["A", "B"],
    });

    // On resume the caller has a fresh unit list.
    const freshUnitList = ["A", "B", "C", "D", "E"];
    const state = readCheckpoint(tmpPath, "ingest:folder");
    const done = new Set(state?.completedIds ?? []);
    const remaining = freshUnitList.filter((u) => !done.has(u));

    expect(remaining).toEqual(["C", "D", "E"]);
  });

  it("starting from a fresh wiki root yields the full unit list", () => {
    const state = readCheckpoint(tmpPath, "ingest:folder");
    const done = new Set(state?.completedIds ?? []);
    const remaining = ["A", "B", "C"].filter((u) => !done.has(u));
    expect(remaining).toEqual(["A", "B", "C"]);
  });

  it("end-to-end: resume after recordUnit interrupts", () => {
    // First "session" processes two units then is interrupted.
    const units = ["u1.md", "u2.md", "u3.md", "u4.md"];
    recordUnit(tmpPath, "ingest:folder", units[0]!);
    recordUnit(tmpPath, "ingest:folder", units[1]!);

    // Second session reads the checkpoint and skips completed units.
    const state = readCheckpoint(tmpPath, "ingest:folder");
    const done = new Set(state?.completedIds ?? []);
    const toProcess = units.filter((u) => !done.has(u));
    expect(toProcess).toEqual(["u3.md", "u4.md"]);

    // Second session completes the rest.
    for (const u of toProcess) {
      recordUnit(tmpPath, "ingest:folder", u);
    }
    expect(readCheckpoint(tmpPath, "ingest:folder")?.completedIds).toEqual(
      units,
    );

    // On successful completion the caller clears the checkpoint.
    clearCheckpoint(tmpPath, "ingest:folder");
    expect(readCheckpoint(tmpPath, "ingest:folder")).toBeNull();
    expect(fs.existsSync(path.join(tmpPath, CHECKPOINT_FILENAME))).toBe(false);
  });
});
