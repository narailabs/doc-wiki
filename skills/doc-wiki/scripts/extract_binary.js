#!/usr/bin/env node
/**
 * Binary file extraction: PDF, DOCX, PPTX to markdown.
 *
 * TypeScript port of extract_binary.py. Mirrors the Python contract:
 *   - format detected from extension (`.pdf`/`.docx`/`.pptx`)
 *   - explicit `--format` flag overrides detection
 *   - missing optional dependency raises a friendly error at call time
 *     (Python uses `ImportError`; we raise `Error` with the same message
 *     style: "Missing optional dependency '<X>'. Install with: npm install <X>")
 *
 * Usage as a library:
 *     import { extract, extractPdf, extractDocx, extractPptx } from "./extract_binary.js";
 *     const md = await extract("report.pdf");
 *     const md = await extractPdf("report.pdf");
 *
 * Usage as a script:
 *     node extract_binary.js report.pdf
 *     node extract_binary.js slides.pptx --format pptx
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { importOptional } from "./_optional.js";
// ── Format registry ────────────────────────────────────────────────
export const FORMAT_MAP = {
    ".pdf": "pdf",
    ".docx": "docx",
    ".pptx": "pptx",
};
// `importOptional` was promoted to `_optional.ts` so extract_multimodal.ts
// can share it. Re-export here so any external imports keep working.
export { importOptional };
// ── Whitespace normalization ───────────────────────────────────────
/**
 * Normalize extracted plain text so PDF / DOCX / PPTX outputs share the
 * same shape as the Python pipeline:
 *   - strip per-line trailing whitespace
 *   - collapse 3+ consecutive newlines down to exactly 2
 *   - trim leading/trailing whitespace overall
 *
 * Applying the same rules in both runtimes keeps test assertions and
 * downstream consumers stable across the migration.
 */
export function normalizeExtracted(text) {
    // Strip trailing whitespace per line (keeps blank lines as `""`, not `"   "`).
    // The line break has to be matched explicitly rather than with `$`+`m`: to a
    // multiline regex `\r` is itself a line terminator, so `$` also matches
    // between consecutive CRs and the run of `\r` gets consumed as "trailing
    // whitespace" — `"left\r\rright"` would lose a CR. Lines here are delimited
    // by `\n` only, matching the rest of the pipeline.
    const stripped = text.replace(/[ \t\r\f\v]+(?=\n|$)/g, "");
    // Collapse 3+ consecutive newlines → exactly 2 (max one blank line).
    const collapsed = stripped.replace(/\n{3,}/g, "\n\n");
    return collapsed.trim();
}
/**
 * Extract text from a PDF file using pdfjs-dist's legacy build (the
 * Node-friendly bundle that doesn't try to load DOM-only worker shims).
 *
 * Per-page strategy (matches PyMuPDF's `page.get_text()` shape closely):
 *   - concatenate all item.str values verbatim (pdfjs already bakes word
 *     spacing into each item from the PDF's glyph positions, mirroring how
 *     PyMuPDF's text extractor emits pre-spaced tokens)
 *   - insert `\n` whenever an item has `hasEOL = true`
 *   - drop pages whose trimmed text is empty (parity with the Python loop)
 * Pages are joined by a blank line and then run through `normalizeExtracted`.
 */
export async function extractPdf(filePath) {
    const pdfjs = await importOptional("pdfjs-dist/legacy/build/pdf.mjs");
    const data = fs.readFileSync(filePath);
    // pdfjs accepts a Uint8Array view; copy into a fresh buffer so it doesn't
    // hold onto Node's pooled allocator.
    const bytes = new Uint8Array(data.byteLength);
    bytes.set(data);
    // verbosity 0 == errors only — silences "standardFontDataUrl" warnings
    // emitted on stderr for PDFs without standard fonts.
    const doc = await pdfjs.getDocument({ data: bytes, verbosity: 0 }).promise;
    try {
        const pages = [];
        for (let i = 1; i <= doc.numPages; i++) {
            const page = await doc.getPage(i);
            const tc = await page.getTextContent();
            const parts = [];
            for (const item of tc.items) {
                if ("str" in item) {
                    parts.push(item.str);
                    if (item.hasEOL)
                        parts.push("\n");
                }
            }
            const joined = parts.join("").trim();
            if (joined.length > 0)
                pages.push(joined);
        }
        return normalizeExtracted(pages.join("\n\n"));
    }
    finally {
        await doc.destroy();
    }
}
/**
 * Extract text from a DOCX file using mammoth.
 *
 * mammoth has an undocumented `convertToMarkdown` (visible in
 * lib/index.js, missing from index.d.ts) that emits `# Heading` for
 * Heading-N styles and double-newline-separates paragraphs — which lines up
 * with `extract_docx` in extract_binary.py. The mammoth `Result.value` is
 * passed through `normalizeExtracted` to flatten the trailing `\n\n` that
 * mammoth appends after every block.
 */
export async function extractDocx(filePath) {
    const mod = await importOptional("mammoth");
    const convertToMarkdown = mod.convertToMarkdown ?? mod.default?.convertToMarkdown;
    if (typeof convertToMarkdown !== "function") {
        throw new Error("Missing optional dependency 'mammoth'. Install with: npm install mammoth");
    }
    const buffer = fs.readFileSync(filePath);
    const result = await convertToMarkdown({ buffer });
    // mammoth's markdown writer escapes ` * _ { } [ ] ( ) # + - . ! and \ in
    // plain text. python-docx outputs raw text, so we undo those escapes for
    // parity. The order matters: drop the escapes for the listed punctuation
    // first, then collapse `\\` back down to `\`.
    const unescaped = result.value
        .replace(/\\([`*_{}\[\]()#+\-.!])/g, "$1")
        .replace(/\\\\/g, "\\");
    return normalizeExtracted(unescaped);
}
/**
 * Walk a fast-xml-parser node tree and collect every `<a:t>` text node,
 * grouped per `<a:p>` paragraph. Returns paragraph texts (pre-trim).
 *
 * fast-xml-parser shape with our options:
 *   - elements become objects keyed by tag name
 *   - text nodes use the configured `textNodeName` (we use `#text`)
 *   - repeated children with the same tag become arrays (we use
 *     `alwaysCreateTextNode` + `isArray` is left default; we handle both
 *     single-object and array shapes below)
 */
function collectPptxParagraphs(node) {
    const paragraphs = [];
    function visit(n) {
        if (n === null || n === undefined)
            return;
        if (Array.isArray(n)) {
            for (const item of n)
                visit(item);
            return;
        }
        if (typeof n !== "object")
            return;
        const obj = n;
        for (const [key, value] of Object.entries(obj)) {
            if (key === "a:p") {
                // Each paragraph: collect its text runs, join with no separator.
                const paras = Array.isArray(value) ? value : [value];
                for (const p of paras) {
                    paragraphs.push(collectRuns(p));
                }
            }
            else {
                // Recurse into other nodes (sp, txBody, etc.).
                visit(value);
            }
        }
    }
    function collectRuns(p) {
        if (p === null || p === undefined)
            return "";
        if (typeof p !== "object")
            return "";
        const out = [];
        function walkRuns(n) {
            if (n === null || n === undefined)
                return;
            if (Array.isArray(n)) {
                for (const item of n)
                    walkRuns(item);
                return;
            }
            if (typeof n !== "object")
                return;
            const obj = n;
            for (const [k, v] of Object.entries(obj)) {
                if (k === "a:t") {
                    // Text node — fast-xml-parser may yield a string, an object with
                    // `#text`, or an array of either.
                    const items = Array.isArray(v) ? v : [v];
                    for (const item of items) {
                        if (typeof item === "string") {
                            out.push(item);
                        }
                        else if (item !== null && typeof item === "object") {
                            const txt = item["#text"];
                            if (typeof txt === "string")
                                out.push(txt);
                            else if (typeof txt === "number")
                                out.push(String(txt));
                        }
                        else if (typeof item === "number") {
                            out.push(String(item));
                        }
                    }
                }
                else if (k !== "#text" && k !== ":@") {
                    walkRuns(v);
                }
            }
        }
        walkRuns(p);
        return out.join("");
    }
    visit(node);
    return paragraphs;
}
/**
 * Extract text from a PPTX file using JSZip + fast-xml-parser.
 *
 * Slides are PPTX zip entries `ppt/slides/slide<N>.xml`, ordered by N.
 * For each slide we collect every `<a:t>` text node grouped by `<a:p>`
 * paragraph (matching python-pptx's `paragraph.text`), drop empty
 * paragraphs, join paragraphs with `\n\n`, and prefix the slide with
 * `## Slide N` to match `extract_pptx` in extract_binary.py.
 */
export async function extractPptx(filePath) {
    const jszipMod = await importOptional("jszip");
    const xmlMod = await importOptional("fast-xml-parser");
    const loadAsync = jszipMod.loadAsync ?? jszipMod.default?.loadAsync;
    if (typeof loadAsync !== "function") {
        throw new Error("Missing optional dependency 'jszip'. Install with: npm install jszip");
    }
    const buf = fs.readFileSync(filePath);
    const zip = await loadAsync(buf);
    // Collect slide entries and sort by their numeric index.
    const slidePaths = Object.keys(zip.files)
        .filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
        .sort((a, b) => slideIndex(a) - slideIndex(b));
    const parser = new xmlMod.XMLParser({
        ignoreAttributes: true,
        textNodeName: "#text",
        parseTagValue: false,
        trimValues: false,
    });
    const sections = [];
    for (let i = 0; i < slidePaths.length; i++) {
        const slidePath = slidePaths[i];
        if (slidePath === undefined)
            continue;
        const entry = zip.file(slidePath);
        if (entry === null)
            continue;
        const xml = await entry.async("string");
        const tree = parser.parse(xml);
        const paragraphs = collectPptxParagraphs(tree)
            .map((p) => p.trim())
            .filter((p) => p.length > 0);
        const slideText = paragraphs.join("\n\n");
        sections.push(`## Slide ${i + 1}\n\n${slideText}`);
    }
    return normalizeExtracted(sections.join("\n\n"));
}
function slideIndex(p) {
    const m = /slide(\d+)\.xml$/.exec(p);
    return m && m[1] ? parseInt(m[1], 10) : 0;
}
// ── Dispatch ───────────────────────────────────────────────────────
/**
 * Extract text from a binary file to markdown.
 *
 * If `fmt` is null/undefined, the format is auto-detected from the file
 * extension. Throws `Error` (mirroring Python's `ValueError`) for
 * unsupported formats.
 */
export async function extract(inputPath, fmt = null) {
    let format = fmt === null || fmt === undefined ? undefined : fmt;
    if (format === undefined) {
        const ext = path.extname(inputPath).toLowerCase();
        format = FORMAT_MAP[ext];
        if (format === undefined) {
            const supported = Object.keys(FORMAT_MAP).sort().join(", ");
            throw new Error(`Unsupported format for '${path.basename(inputPath)}'. ` +
                `Supported extensions: ${supported}`);
        }
    }
    if (format === "pdf")
        return extractPdf(inputPath);
    if (format === "docx")
        return extractDocx(inputPath);
    if (format === "pptx")
        return extractPptx(inputPath);
    throw new Error(`Unsupported format: ${format}`);
}
// ── CLI ────────────────────────────────────────────────────────────
const HELP_TEXT = `usage: extract_binary.js [-h] [--format {pdf,docx,pptx}] input_file

Extract text from binary files (PDF, DOCX, PPTX) to markdown.

positional arguments:
  input_file            Path to the binary file

options:
  -h, --help            show this help message and exit
  --format {pdf,docx,pptx}
                        Force format (auto-detected if omitted)
`;
/**
 * Hand-rolled argparse-equivalent. Accepts a single positional `input_file`
 * plus the `--format` flag (with `=` or space-separated value) and `-h`.
 * Unknown flags or duplicate positionals throw with an argparse-ish message.
 */
function parseCli(argv) {
    const out = {};
    let i = 0;
    while (i < argv.length) {
        const a = argv[i];
        if (a === undefined) {
            i++;
            continue;
        }
        if (a === "-h" || a === "--help") {
            out.help = true;
            i++;
            continue;
        }
        if (a === "--format") {
            const v = argv[i + 1];
            if (v === undefined) {
                throw new Error("argument --format: expected one argument");
            }
            out.format = coerceFormat(v);
            i += 2;
            continue;
        }
        if (a.startsWith("--format=")) {
            out.format = coerceFormat(a.slice("--format=".length));
            i++;
            continue;
        }
        if (a.startsWith("-")) {
            throw new Error(`unrecognized arguments: ${a}`);
        }
        if (out.inputFile !== undefined) {
            throw new Error(`unrecognized arguments: ${a}`);
        }
        out.inputFile = a;
        i++;
    }
    return out;
}
function coerceFormat(v) {
    if (v === "pdf" || v === "docx" || v === "pptx")
        return v;
    throw new Error(`argument --format: invalid choice: '${v}' (choose from 'pdf', 'docx', 'pptx')`);
}
export async function main(argv = process.argv.slice(2)) {
    let args;
    try {
        args = parseCli(argv);
    }
    catch (e) {
        process.stderr.write(`${e.message}\n`);
        return 2;
    }
    if (args.help) {
        process.stdout.write(HELP_TEXT);
        return 0;
    }
    if (args.inputFile === undefined) {
        process.stderr.write("the following arguments are required: input_file\n");
        return 2;
    }
    const result = await extract(args.inputFile, args.format ?? null);
    process.stdout.write(result + "\n");
    return 0;
}
// CLI entry point: run main() when this file is executed directly.
const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === thisFile) {
    main().then((code) => process.exit(code), (e) => {
        process.stderr.write(`${e.message}\n`);
        process.exit(1);
    });
}
