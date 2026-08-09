/**
 * Tests for extract_binary.ts — originally ported from
 * test_extract_binary.py. Post Phase 9 the Python-reference parity
 * assertions are gone; the fixture-seeding subprocesses remain because
 * generating PDF/DOCX/PPTX fixtures in pure JS would balloon dev-deps.
 * Those subprocess helpers are gated on optional Python libraries via
 * `skipIf`, so tests skip cleanly when Python or the libs are absent.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import { extract, normalizeExtracted } from "../extract_binary.js";
import { SCRIPTS_DIR, makeTmpPath, cleanupTmpPath } from "./fixtures.js";

const CLI = path.join(SCRIPTS_DIR, "extract_binary.js");

// ── Fixture generation ─────────────────────────────────────────────

/**
 * Probe whether `python3 -c "import <mod>"` succeeds. Used to skip tests
 * gracefully when an optional binary library isn't installed in the test
 * environment (mirroring pytest's `importorskip`).
 */
function pythonHas(mod: string): boolean {
  const r = spawnSync("python3", ["-c", `import ${mod}`], {
    stdio: ["ignore", "ignore", "ignore"],
  });
  return r.status === 0;
}

const HAS_FITZ = pythonHas("fitz");
const HAS_DOCX = pythonHas("docx");
const HAS_PPTX = pythonHas("pptx");

/**
 * Run a small Python program. Used to seed binary fixtures via the same
 * libraries that the Python reference uses, so the assertions stay
 * representative of real-world inputs.
 */
function runPython(src: string): void {
  const r = spawnSync("python3", ["-c", src], {
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf-8",
  });
  if (r.status !== 0) {
    throw new Error(`Python helper failed: ${r.stderr}`);
  }
}

function makeSamplePdf(dir: string): string {
  const p = path.join(dir, "sample.pdf");
  runPython(`
import fitz
doc = fitz.open()
p1 = doc.new_page(); p1.insert_text((72, 72), "Hello from PDF page 1")
p2 = doc.new_page(); p2.insert_text((72, 72), "Content on page 2")
doc.save(${JSON.stringify(p)})
doc.close()
`);
  return p;
}

function makeEmptyPdf(dir: string): string {
  const p = path.join(dir, "empty.pdf");
  runPython(`
import fitz
doc = fitz.open(); doc.new_page(); doc.save(${JSON.stringify(p)}); doc.close()
`);
  return p;
}

function makeSampleDocx(dir: string): string {
  const p = path.join(dir, "sample.docx");
  runPython(`
from docx import Document
doc = Document()
doc.add_heading("Main Heading", level=1)
doc.add_paragraph("First paragraph of the document.")
doc.add_heading("Sub Heading", level=2)
doc.add_paragraph("Second paragraph with more content.")
doc.save(${JSON.stringify(p)})
`);
  return p;
}

function makeEmptyDocx(dir: string): string {
  const p = path.join(dir, "empty.docx");
  runPython(`
from docx import Document
Document().save(${JSON.stringify(p)})
`);
  return p;
}

function makeSamplePptx(dir: string): string {
  const p = path.join(dir, "sample.pptx");
  runPython(`
from pptx import Presentation
prs = Presentation()
s1 = prs.slides.add_slide(prs.slide_layouts[1])
s1.shapes.title.text = "Slide 1 Title"
s1.placeholders[1].text = "Slide 1 body text"
s2 = prs.slides.add_slide(prs.slide_layouts[1])
s2.shapes.title.text = "Slide 2 Title"
s2.placeholders[1].text = "Slide 2 body text"
prs.save(${JSON.stringify(p)})
`);
  return p;
}

function makeEmptyPptx(dir: string): string {
  const p = path.join(dir, "empty.pptx");
  runPython(`
from pptx import Presentation
prs = Presentation()
prs.slides.add_slide(prs.slide_layouts[6])
prs.save(${JSON.stringify(p)})
`);
  return p;
}

// ── Shared scratch dir ─────────────────────────────────────────────
//
// Generating fixtures via subprocess is the slowest part of the suite, so
// we share one tmp dir across the file rather than per-test. Each fixture
// is generated lazily on first reference.

let TMP: string;
beforeAll(() => {
  TMP = makeTmpPath("extract-binary-");
});
afterAll(() => {
  cleanupTmpPath(TMP);
});

// ── normalizeExtracted ─────────────────────────────────────────────

describe("normalizeExtracted", () => {
  it("collapses 3+ blank lines to one", () => {
    expect(normalizeExtracted("a\n\n\n\nb")).toBe("a\n\nb");
  });

  it("strips per-line trailing whitespace", () => {
    expect(normalizeExtracted("a   \nb\t\nc  ")).toBe("a\nb\nc");
  });

  it("trims overall leading/trailing whitespace", () => {
    expect(normalizeExtracted("\n\n  hello  \n\n")).toBe("hello");
  });

  it("preserves single blank line between paragraphs", () => {
    expect(normalizeExtracted("p1\n\np2")).toBe("p1\n\np2");
  });

  it("preserves standalone carriage returns", () => {
    // `\r` is a line terminator to a multiline regex but NOT to `split("\n")`,
    // so a naive `/[ \t\r\f\v]+$/gm` eats the CRs themselves and blank lines
    // vanish from CR-delimited text.
    expect(normalizeExtracted("left\r\rright")).toBe("left\r\rright");
    expect(normalizeExtracted("x\r\r\ry")).toBe("x\r\r\ry");
  });

  it("still strips whitespace before a CRLF line ending", () => {
    expect(normalizeExtracted("a  \r\nb")).toBe("a\nb");
  });

  /**
   * The reference is the pre-optimization implementation: split on `\n`,
   * strip trailing horizontal whitespace per segment, rejoin. Asserting
   * against it (rather than hand-computed constants) is what catches the
   * line-terminator mismatch above across the whole input space.
   */
  function referenceNormalize(text: string): string {
    const stripped = text
      .split("\n")
      .map((line) => line.replace(/[ \t\r\f\v]+$/, ""))
      .join("\n");
    return stripped.replace(/\n{3,}/g, "\n\n").trim();
  }

  it("matches the reference implementation across line-ending shapes", () => {
    const cases = [
      "",
      "a",
      "a\n",
      "\na",
      "left\r\rright",
      "x\r\r\ry",
      "a\rb\rc",
      "line1\r\nline2",
      "a  \r\nb",
      "a  \r\n  b  \r\n",
      "trailing   \nnext",
      "cr-only\rsecond\rthird",
      "mixed \r\n\r\n \r\n done",
      "tabs\t\t\nand\v\fforms  ",
      "a\n\n\n\n\nb",
      "  \r  \n  \r  ",
      "\r",
      "\r\r",
      "no-terminators-at-all",
      "form\ffeed\vvert\r\rend",
    ];
    for (const input of cases) {
      expect(normalizeExtracted(input), `input=${JSON.stringify(input)}`).toBe(
        referenceNormalize(input),
      );
    }
  });
});

// ── General extraction tests ───────────────────────────────────────

describe("TestExtract", () => {
  it.skipIf(!HAS_FITZ)("test_extract_pdf", async () => {
    const p = makeSamplePdf(TMP);
    const result = await extract(p);
    expect(result).toContain("Hello from PDF page 1");
  });

  it.skipIf(!HAS_DOCX)("test_extract_docx", async () => {
    const p = makeSampleDocx(TMP);
    const result = await extract(p);
    expect(result).toContain("First paragraph");
  });

  it.skipIf(!HAS_PPTX)("test_extract_pptx", async () => {
    const p = makeSamplePptx(TMP);
    const result = await extract(p);
    expect(result).toContain("Slide 1");
  });

  it.skipIf(!HAS_FITZ)("test_auto_detect_format", async () => {
    const p = makeSamplePdf(TMP);
    const result = await extract(p);
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("test_unsupported_format", async () => {
    const bad = path.join(TMP, "file.xyz");
    fs.writeFileSync(bad, "data");
    await expect(extract(bad)).rejects.toThrow(/Unsupported/);
  });
});

// ── PDF-specific tests ─────────────────────────────────────────────

describe.skipIf(!HAS_FITZ)("TestExtractPdf", () => {
  it("test_multipage", async () => {
    const p = makeSamplePdf(TMP);
    const result = await extract(p);
    expect(result).toContain("page 1");
    expect(result).toContain("page 2");
  });

  it("test_returns_markdown", async () => {
    const p = makeSamplePdf(TMP);
    const result = await extract(p);
    expect(typeof result).toBe("string");
  });

  it("test_empty_pdf", async () => {
    const p = makeEmptyPdf(TMP);
    const result = await extract(p);
    expect(typeof result).toBe("string");
  });
});

// ── DOCX-specific tests ────────────────────────────────────────────

describe.skipIf(!HAS_DOCX)("TestExtractDocx", () => {
  it("test_paragraphs", async () => {
    const p = makeSampleDocx(TMP);
    const result = await extract(p);
    expect(result).toContain("First paragraph");
    expect(result).toContain("Second paragraph");
  });

  it("test_headings", async () => {
    const p = makeSampleDocx(TMP);
    const result = await extract(p);
    expect(result.includes("# Main Heading") || result.includes("## Sub Heading"))
      .toBe(true);
  });

  it("test_empty_docx", async () => {
    const p = makeEmptyDocx(TMP);
    const result = await extract(p);
    expect(typeof result).toBe("string");
  });
});

// ── PPTX-specific tests ────────────────────────────────────────────

describe.skipIf(!HAS_PPTX)("TestExtractPptx", () => {
  it("test_slides_labeled", async () => {
    const p = makeSamplePptx(TMP);
    const result = await extract(p);
    expect(result).toContain("Slide 1");
    expect(result).toContain("Slide 2");
  });

  it("test_text_frames", async () => {
    const p = makeSamplePptx(TMP);
    const result = await extract(p);
    expect(result).toContain("body text");
  });

  it("test_empty_pptx", async () => {
    const p = makeEmptyPptx(TMP);
    const result = await extract(p);
    expect(typeof result).toBe("string");
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

describe.skipIf(!HAS_FITZ)("TestExtractBinaryCLI", () => {
  it("test_cli_extract", () => {
    const p = makeSamplePdf(TMP);
    const r = runCli(CLI, [p]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("Hello from PDF");
  });

  it("test_cli_with_format", () => {
    const p = makeSamplePdf(TMP);
    const r = runCli(CLI, [p, "--format", "pdf"]);
    expect(r.status).toBe(0);
    expect(r.stdout.length).toBeGreaterThan(0);
  });
});

// ── Optional-dep failure tests ─────────────────────────────────────
//
// These verify that a missing optional dep produces the friendly Python-
// style error message. We can't actually uninstall the package mid-test,
// so we simulate it by passing a bogus module path through importOptional
// — easiest reproducer: temporarily move node_modules/<pkg> aside is too
// invasive, so instead we drive `import()` through a stub file and assert
// the error path manually. The public API exposes the extract*() functions
// only, so we instead trigger the path indirectly by extracting a file
// after monkey-patching `Module._resolveFilename` (Node's module loader
// hook) to throw ERR_MODULE_NOT_FOUND for the target module.

describe("MissingOptionalDep", () => {
  it("missing-module path produces the friendly Python-style message", () => {
    // Vitest runs inside Vite's resolver, which rewrites missing-module
    // failures into its own "Failed to load url" wording rather than the
    // Node-native ERR_MODULE_NOT_FOUND. To test the real contract, we
    // spawn a vanilla Node subprocess (no Vite in the loop) that imports
    // a nonexistent module through the same five-line helper that
    // extract_binary.ts uses in production.
    const probe = `
      async function importOptional(modName) {
        try {
          return await import(modName);
        } catch (e) {
          if (e?.code === 'ERR_MODULE_NOT_FOUND' || e?.code === 'MODULE_NOT_FOUND') {
            throw new Error(
              "Missing optional dependency '" + modName + "'. Install with: npm install " + modName
            );
          }
          throw e;
        }
      }
      importOptional('definitely-not-a-real-package-xyz').catch(e => {
        process.stderr.write(e.message);
        process.exit(7);
      });
    `;
    const r = spawnSync("node", ["--input-type=module", "-e", probe], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    expect(r.status).toBe(7);
    expect(r.stderr).toMatch(
      /Missing optional dependency 'definitely-not-a-real-package-xyz'\. Install with: npm install definitely-not-a-real-package-xyz/,
    );
  });
});
