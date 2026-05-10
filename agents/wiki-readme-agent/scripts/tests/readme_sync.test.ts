import { describe, it, expect } from "vitest";
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
});
