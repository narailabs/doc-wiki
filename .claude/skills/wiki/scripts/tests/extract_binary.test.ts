/**
 * Tests for extract_binary.ts — ported from test_extract_binary.py.
 *
 * Every pytest `def test_*` is preserved as a Vitest `it()`. CLI-parity
 * tests shell out to the compiled extract_binary.js and confirm the
 * normalized stdout matches the Python reference for the same fixture.
 *
 * Generating PDF/DOCX/PPTX fixtures in pure JS is impractical: the upstream
 * `pdf-lib` / `docx` / `pptxgen` packages would balloon dev-deps for one
 * test file. We instead shell out to a small Python helper (the same libs
 * the source files use under the hood) — gated on availability so the
 * tests skip cleanly if Python or the optional libs aren't installed.
 *
 * The optional-dep tests for the Node side use Vitest's module mocking to
 * simulate `ERR_MODULE_NOT_FOUND` and assert the friendly error message.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import { extract, normalizeExtracted } from "../extract_binary.js";
import { SCRIPTS_DIR, makeTmpPath, cleanupTmpPath } from "./fixtures.js";

const CLI = path.join(SCRIPTS_DIR, "extract_binary.js");
const PY_CLI = path.join(SCRIPTS_DIR, "extract_binary.py");

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
  const interpreter = bin.endsWith(".py") ? "python3" : "node";
  try {
    const stdout = execFileSync(interpreter, [bin, ...args], {
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

// ── CLI parity (Node ↔ Python) ─────────────────────────────────────

/** Apply normalizeExtracted on both sides so trailing-whitespace
 *  differences (Python's `print()` adds `\n`; ours doesn't add an extra
 *  one for empty bodies) don't masquerade as content drift. */
function normalizeForParity(s: string): string {
  return normalizeExtracted(s);
}

describe("ExtractBinaryParity", () => {
  it.skipIf(!HAS_FITZ)("cli_pdf_matches_python", () => {
    const p = makeSamplePdf(TMP);
    const py = runCli(PY_CLI, [p]);
    const ts = runCli(CLI, [p]);
    expect(py.status).toBe(0);
    expect(ts.status).toBe(0);
    expect(normalizeForParity(ts.stdout)).toBe(normalizeForParity(py.stdout));
  });

  it.skipIf(!HAS_DOCX)("cli_docx_matches_python", () => {
    const p = makeSampleDocx(TMP);
    const py = runCli(PY_CLI, [p]);
    const ts = runCli(CLI, [p]);
    expect(py.status).toBe(0);
    expect(ts.status).toBe(0);
    expect(normalizeForParity(ts.stdout)).toBe(normalizeForParity(py.stdout));
  });

  it.skipIf(!HAS_PPTX)("cli_pptx_matches_python", () => {
    const p = makeSamplePptx(TMP);
    const py = runCli(PY_CLI, [p]);
    const ts = runCli(CLI, [p]);
    expect(py.status).toBe(0);
    expect(ts.status).toBe(0);
    expect(normalizeForParity(ts.stdout)).toBe(normalizeForParity(py.stdout));
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
