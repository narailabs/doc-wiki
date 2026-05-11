import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  MARKER_START,
  MARKER_END,
  extractMarkerBlock,
  replaceMarkerBlock,
  insertMarkers,
  MarkersMissingError,
  MarkersCorruptError,
} from "../readme_sync.js";

describe("extractMarkerBlock", () => {
  it("returns the inner content when markers are present and balanced", () => {
    const readme = `# Title\n\n## Install\n\n${MARKER_START}\nhello\n${MARKER_END}\n\n## Other\n`;
    const out = extractMarkerBlock(readme);
    expect(out.between).toBe("hello");
    expect(out.before.endsWith("## Install\n\n")).toBe(true);
    expect(out.after.startsWith("\n\n## Other")).toBe(true);
  });

  it("throws MarkersMissingError when no markers are present", () => {
    expect(() => extractMarkerBlock("# Title\n\nNo markers here\n")).toThrow(
      MarkersMissingError,
    );
  });

  it("throws MarkersCorruptError when markers are unbalanced", () => {
    const readme = `# Title\n${MARKER_START}\nhello\n${MARKER_START}\nworld\n${MARKER_END}\n`;
    expect(() => extractMarkerBlock(readme)).toThrow(MarkersCorruptError);
  });

  it("throws MarkersCorruptError when end marker precedes start marker", () => {
    const readme = `# T\n${MARKER_END}\nhello\n${MARKER_START}\n`;
    expect(() => extractMarkerBlock(readme)).toThrow(MarkersCorruptError);
  });
});

describe("replaceMarkerBlock", () => {
  it("replaces the inner content while preserving outer text", () => {
    const readme = `# Title\n\n${MARKER_START}\nold\n${MARKER_END}\n\n## More\n`;
    const out = replaceMarkerBlock(readme, "new content");
    expect(out).toBe(
      `# Title\n\n${MARKER_START}\nnew content\n${MARKER_END}\n\n## More\n`,
    );
  });

  it("is idempotent for the same input block", () => {
    const readme = `# Title\n\n${MARKER_START}\nx\n${MARKER_END}\n`;
    const once = replaceMarkerBlock(readme, "x");
    const twice = replaceMarkerBlock(once, "x");
    expect(twice).toBe(once);
  });
});

describe("insertMarkers", () => {
  it("inserts markers after the install heading", () => {
    const readme = "# Title\n\n## Install\n\nRun npm install.\n\n## Usage\n";
    const out = insertMarkers(readme, "PLACEHOLDER");
    expect(out).toContain(`## Install\n\n${MARKER_START}\nPLACEHOLDER\n${MARKER_END}\n`);
    expect(out).toContain("## Usage");
  });

  it("falls back to the first ## heading when no install heading exists", () => {
    const readme = "# Title\n\n## Overview\n\nText.\n";
    const out = insertMarkers(readme, "PLACEHOLDER");
    expect(out.indexOf(MARKER_START)).toBeGreaterThan(out.indexOf("## Overview"));
  });

  it("ignores ## headings inside fenced code blocks", () => {
    // The first `## Install` lives inside a fenced markdown sample and must
    // be ignored — the marker should land after the REAL `## Install`
    // heading, and the fenced code must remain intact.
    const readme = [
      "# Title",
      "",
      "## Overview",
      "",
      "Example markdown:",
      "",
      "```markdown",
      "## Install",
      "echo not real",
      "```",
      "",
      "## Install",
      "",
      "Real install instructions.",
      "",
    ].join("\n");
    const out = insertMarkers(readme, "PLACEHOLDER");
    // The fenced sample is intact (no MARKER_START between its fences)
    const fenceStart = out.indexOf("```markdown");
    const fenceEnd = out.indexOf("```", fenceStart + 1);
    const insideFence = out.substring(fenceStart, fenceEnd);
    expect(insideFence).not.toContain(MARKER_START);
    // Marker is after the REAL install heading (the second `## Install`)
    const realInstallIdx = out.lastIndexOf("## Install");
    const markerIdx = out.indexOf(MARKER_START);
    expect(markerIdx).toBeGreaterThan(realInstallIdx);
  });

  it("falls back to the first ## heading outside any fence", () => {
    // No install heading at all; fenced `## Install` must NOT be selected.
    const readme = [
      "# Title",
      "",
      "```markdown",
      "## Install",
      "fake",
      "```",
      "",
      "## Overview",
      "",
      "Text.",
      "",
    ].join("\n");
    const out = insertMarkers(readme, "PLACEHOLDER");
    // Marker is after `## Overview`, not after the fake install in the fence
    expect(out.indexOf(MARKER_START)).toBeGreaterThan(out.indexOf("## Overview"));
    // Fenced sample intact
    const fenceStart = out.indexOf("```markdown");
    const fenceEnd = out.indexOf("```", fenceStart + 1);
    expect(out.substring(fenceStart, fenceEnd)).not.toContain(MARKER_START);
  });

  it("respects fence length — 4-backtick fence is not closed by 3-backtick line", () => {
    // Common pattern: a 4-backtick fence containing a 3-backtick example.
    // The 3-backtick line is CONTENT, not a fence delimiter, so the
    // outer fence stays open and the `## Install` inside it must NOT
    // be selected as the anchor.
    const readme = [
      "# Title",
      "",
      "## Overview",
      "",
      "Outer code fence:",
      "",
      "````markdown",
      "Here is how to write a fenced block:",
      "```bash",
      "echo hi",
      "```",
      "## Install  (this line is INSIDE the outer 4-backtick fence)",
      "more content",
      "````",
      "",
      "## Install",
      "",
      "Real install instructions.",
      "",
    ].join("\n");
    const out = insertMarkers(readme, "PLACEHOLDER");
    // The outer 4-backtick fence stays intact (open ` ```` ` to close ` ```` `)
    const outerStart = out.indexOf("````markdown");
    const outerEnd = out.indexOf("````", outerStart + 4);
    expect(outerStart).toBeGreaterThan(-1);
    expect(outerEnd).toBeGreaterThan(outerStart);
    // No marker landed inside the outer fence
    expect(out.substring(outerStart, outerEnd)).not.toContain(MARKER_START);
    // Marker landed AFTER the real install heading (the second one)
    const realInstallIdx = out.lastIndexOf("## Install");
    const markerIdx = out.indexOf(MARKER_START);
    expect(markerIdx).toBeGreaterThan(realInstallIdx);
  });
});

const SCRIPTS_DIR = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
);
const CLI = path.join(SCRIPTS_DIR, "readme_sync.js");

function runCli(args: readonly string[]): {
  stdout: string;
  stderr: string;
  status: number;
} {
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

describe("CLI: extract", () => {
  it("emits the inner block as JSON", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "readme-sync-"));
    const readmePath = path.join(tmp, "README.md");
    fs.writeFileSync(
      readmePath,
      `# T\n\n${MARKER_START}\nbetween\n${MARKER_END}\n`,
    );
    const { stdout, status } = runCli(["extract", "--readme", readmePath]);
    expect(status).toBe(0);
    const out = JSON.parse(stdout);
    expect(out.between).toBe("between");
  });

  it("emits structured error JSON on missing markers", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "readme-sync-"));
    const readmePath = path.join(tmp, "README.md");
    fs.writeFileSync(readmePath, `# Title\n\nNo markers.\n`);
    const { stdout, status } = runCli(["extract", "--readme", readmePath]);
    expect(status).toBe(1);
    const out = JSON.parse(stdout);
    expect(out.status).toBe("error");
    expect(out.error_code).toBe("MARKERS_MISSING");
  });
});

describe("CLI: write", () => {
  it("writes a new block from --block-file", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "readme-sync-"));
    const readmePath = path.join(tmp, "README.md");
    const blockPath = path.join(tmp, "block.txt");
    fs.writeFileSync(
      readmePath,
      `# T\n\n${MARKER_START}\nold\n${MARKER_END}\n`,
    );
    fs.writeFileSync(blockPath, "fresh content");
    const { status } = runCli([
      "write",
      "--readme",
      readmePath,
      "--block-file",
      blockPath,
    ]);
    expect(status).toBe(0);
    expect(fs.readFileSync(readmePath, "utf-8")).toContain(
      `${MARKER_START}\nfresh content\n${MARKER_END}`,
    );
  });
});

describe("CLI: init", () => {
  it("inserts markers when missing and depth=generous", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "readme-sync-"));
    const readmePath = path.join(tmp, "README.md");
    fs.writeFileSync(readmePath, `# T\n\n## Install\n\nrun npm install\n`);
    const { status } = runCli([
      "init",
      "--readme",
      readmePath,
      "--depth",
      "generous",
    ]);
    expect(status).toBe(0);
    const out = fs.readFileSync(readmePath, "utf-8");
    expect(out).toContain(MARKER_START);
    expect(out).toContain(MARKER_END);
    expect(out.indexOf(MARKER_START)).toBeGreaterThan(out.indexOf("## Install"));
  });

  it("is idempotent when markers already exist", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "readme-sync-"));
    const readmePath = path.join(tmp, "README.md");
    const original = `# T\n\n## Install\n${MARKER_START}\nx\n${MARKER_END}\n`;
    fs.writeFileSync(readmePath, original);
    const { status } = runCli([
      "init",
      "--readme",
      readmePath,
      "--depth",
      "minimal",
    ]);
    expect(status).toBe(0);
    expect(fs.readFileSync(readmePath, "utf-8")).toBe(original);
  });
});

describe("CLI: usage errors", () => {
  it("returns exit 2 on missing --readme", () => {
    const { status } = runCli(["extract"]);
    expect(status).toBe(2);
  });

  it("returns exit 2 on invalid --depth", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "readme-sync-"));
    const readmePath = path.join(tmp, "README.md");
    fs.writeFileSync(readmePath, "# T\n## Install\n");
    const { status } = runCli([
      "init",
      "--readme",
      readmePath,
      "--depth",
      "medium",
    ]);
    expect(status).toBe(2);
  });

  it("returns exit 2 on unknown subcommand", () => {
    const { status } = runCli(["nope"]);
    expect(status).toBe(2);
  });

  it("returns exit 1 with BLOCK_FILE_MISSING when --block-file does not exist", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "readme-sync-"));
    const readmePath = path.join(tmp, "README.md");
    fs.writeFileSync(
      readmePath,
      `# T\n${MARKER_START}\nold\n${MARKER_END}\n`,
    );
    const { stdout, status } = runCli([
      "write",
      "--readme",
      readmePath,
      "--block-file",
      path.join(tmp, "missing.txt"),
    ]);
    expect(status).toBe(1);
    const out = JSON.parse(stdout);
    expect(out.error_code).toBe("BLOCK_FILE_MISSING");
  });
});
