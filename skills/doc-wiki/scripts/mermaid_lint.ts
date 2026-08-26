#!/usr/bin/env node
/**
 * Mermaid diagram syntax validation for wiki pages.
 *
 * Extracts fenced ``mermaid`` code blocks, validates structural syntax
 * (diagram type, balanced brackets), and reports errors as lint warnings.
 *
 * Usage as a library:
 *     import { extractMermaidBlocks, validateBlock, lintPage } from "./mermaid_lint.js";
 *     const blocks = extractMermaidBlocks(content);
 *     const errors = validateBlock(blockContent);
 *     const issues = lintPage("wiki/auth/session.md");
 *
 * Usage as a script:
 *     node mermaid_lint.js --page wiki/auth/session.md
 *     node mermaid_lint.js --wiki-root /path/to/wiki
 *
 * This is a TypeScript port of mermaid_lint.py; behaviour and CLI output
 * match the Python reference byte-for-byte for the same inputs.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

// ── Constants ───────────────────────────────────────────────────────

export const VALID_DIAGRAM_TYPES: ReadonlySet<string> = new Set([
  "erDiagram",
  "sequenceDiagram",
  "graph",
  "flowchart",
  "classDiagram",
  "stateDiagram",
  "gantt",
  "pie",
  "gitgraph",
]);

/**
 * Matches Python's `re.compile(r"```mermaid\s*\n(.*?)```", re.DOTALL)`.
 * Constructed dynamically to avoid closing the ``` inside a JS template.
 * `s` flag = DOTALL; `g` flag = iterate all matches.
 */
const _MERMAID_BLOCK_RE: RegExp = new RegExp(
  "```mermaid\\s*\\n([\\s\\S]*?)```",
  "g",
);

const _BRACKET_PAIRS: Readonly<Record<string, string>> = {
  "[": "]",
  "{": "}",
  "(": ")",
};

const _BRACKET_OPENERS: ReadonlySet<string> = new Set(["[", "{", "("]);
const _BRACKET_CLOSERS: ReadonlySet<string> = new Set(["]", "}", ")"]);

/** Diagram types where `{ }` are used in relationship syntax, not as block
 *  delimiters — bracket balancing is skipped for these. */
const _RELATIONSHIP_BRACKET_TYPES: ReadonlySet<string> = new Set(["erDiagram"]);

// ── Library API ─────────────────────────────────────────────────────

/** Shape of a single extracted mermaid block. */
export interface MermaidBlock {
  line: number;
  content: string;
  diagram_type: string;
}

/**
 * Extract all fenced mermaid code blocks from markdown content.
 *
 * Returns a list of dicts, each with:
 * - `line`: 1-indexed line number of the opening fence
 * - `content`: the block content (between fences)
 * - `diagram_type`: first keyword (e.g. `erDiagram`, `graph`)
 */
export function extractMermaidBlocks(content: string): MermaidBlock[] {
  const blocks: MermaidBlock[] = [];
  // Reset the regex's internal state before scanning — `g` flag is stateful.
  _MERMAID_BLOCK_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = _MERMAID_BLOCK_RE.exec(content)) !== null) {
    // Python: content[:match.start()].count("\n") + 1
    const startIdx = match.index;
    let newlines = 0;
    for (let i = 0; i < startIdx; i++) {
      if (content[i] === "\n") newlines++;
    }
    const lineNum = newlines + 1;
    const captured = match[1] ?? "";
    const blockContent = captured.trim();
    // Diagram type is the first non-empty token
    const firstLine = blockContent
      ? (blockContent.split("\n")[0] ?? "").trim()
      : "";
    const diagramType = firstLine
      ? (firstLine.split(/\s+/).filter((s) => s.length > 0)[0] ?? "")
      : "";
    blocks.push({
      line: lineNum,
      content: blockContent,
      diagram_type: diagramType,
    });
  }
  return blocks;
}

/**
 * Validate a mermaid block's structural syntax.
 *
 * Returns a list of error messages. Empty list means valid.
 */
export function validateBlock(block: string): string[] {
  const trimmed = block.trim();
  const errors: string[] = [];

  if (!trimmed) {
    errors.push("Empty mermaid block");
    return errors;
  }

  // Check diagram type
  const firstLine = (trimmed.split("\n")[0] ?? "").trim();
  const diagramType = firstLine
    ? (firstLine.split(/\s+/).filter((s) => s.length > 0)[0] ?? "")
    : "";

  if (!VALID_DIAGRAM_TYPES.has(diagramType)) {
    const sorted = [...VALID_DIAGRAM_TYPES].sort();
    errors.push(
      `Unrecognized diagram type '${diagramType}'. ` +
        `Expected one of: ${sorted.join(", ")}`,
    );
  }

  // Check balanced brackets (skip for diagram types that use { } in syntax)
  if (!_RELATIONSHIP_BRACKET_TYPES.has(diagramType)) {
    const stack: string[] = [];
    let stopped = false;
    // TODO: balance check ignores quote context; `A["{test}"]` would miscount.
    // Preserved parity with mermaid_lint.py — both have this pre-existing limitation.
    for (const ch of trimmed) {
      if (_BRACKET_OPENERS.has(ch)) {
        stack.push(ch);
      } else if (_BRACKET_CLOSERS.has(ch)) {
        if (stack.length === 0) {
          errors.push(`Unmatched closing bracket '${ch}'`);
          stopped = true;
          break;
        }
        const opener = stack.pop()!;
        if (_BRACKET_PAIRS[opener] !== ch) {
          errors.push(
            `Mismatched brackets: '${opener}' opened but '${ch}' found`,
          );
          stopped = true;
          break;
        }
      }
    }
    if (!stopped && stack.length > 0) {
      const unclosed = stack.join("");
      errors.push(`Unclosed brackets: ${unclosed}`);
    }
  }

  return errors;
}

/** Shape of a lint issue returned per problematic block. */
export interface MermaidIssue {
  page: string;
  line: number;
  errors: string[];
}

/**
 * Lint all mermaid blocks in a single wiki page.
 *
 * Returns a list of issue dicts for blocks with errors:
 * `{page, line, errors}`
 */
export function lintPage(pagePath: string): MermaidIssue[] {
  const content = fs.readFileSync(pagePath, { encoding: "utf-8" });
  const blocks = extractMermaidBlocks(content);
  const issues: MermaidIssue[] = [];
  for (const block of blocks) {
    const errors = validateBlock(block.content);
    if (errors.length > 0) {
      issues.push({
        page: pagePath,
        line: block.line,
        errors,
      });
    }
  }
  return issues;
}

/** Recursively enumerate all `.md` files beneath `root`, sorted lexicographically
 *  to match Python's `sorted(Path(wiki_dir).rglob("*.md"))`. */
function rglobMarkdown(root: string): string[] {
  const out: string[] = [];
  const stack: string[] = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    if (dir === undefined) continue;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile() && full.endsWith(".md")) {
        out.push(full);
      }
    }
  }
  out.sort();
  return out;
}

/**
 * Lint all mermaid blocks in all wiki pages.
 *
 * Globs `wiki/**\/*.md` under `wikiRoot`.
 */
export function lintWikiMermaid(wikiRoot: string): MermaidIssue[] {
  const wikiDir = path.join(wikiRoot, "wiki");
  if (!fs.existsSync(wikiDir)) {
    return [];
  }
  const issues: MermaidIssue[] = [];
  for (const page of rglobMarkdown(wikiDir)) {
    issues.push(...lintPage(page));
  }
  return issues;
}

// ── CLI ─────────────────────────────────────────────────────────────

interface ParsedArgs {
  page?: string;
  wikiRoot?: string;
  help?: boolean;
}

/**
 * Hand-rolled argparse-equivalent. Accepts `--flag value` or `--flag=value`
 * and the `-h`/`--help` flag. Unknown flags throw.
 */
function parseArgs(argv: readonly string[]): ParsedArgs {
  const out: ParsedArgs = {};
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
    let name: string;
    let value: string | undefined;
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq >= 0) {
        name = a.slice(2, eq);
        value = a.slice(eq + 1);
        i++;
      } else {
        name = a.slice(2);
        value = argv[i + 1];
        i += 2;
      }
    } else {
      throw new Error(`unrecognized argument: ${a}`);
    }
    switch (name) {
      case "page":
        out.page = value ?? "";
        break;
      case "wiki-root":
        out.wikiRoot = value ?? "";
        break;
      default:
        throw new Error(`unrecognized argument: --${name}`);
    }
  }
  return out;
}

const HELP_TEXT = `usage: mermaid_lint.js [-h] [--page PAGE] [--wiki-root WIKI_ROOT]

Validate Mermaid diagram syntax in wiki pages.

options:
  -h, --help            show this help message and exit
  --page PAGE           Lint a single page
  --wiki-root WIKI_ROOT
                        Lint all pages in wiki/
`;

export function main(argv: readonly string[] = process.argv.slice(2)): number {
  let args: ParsedArgs;
  try {
    args = parseArgs(argv);
  } catch (e) {
    process.stderr.write(`${(e as Error).message}\n`);
    return 2;
  }

  if (args.help) {
    process.stdout.write(HELP_TEXT);
    return 0;
  }

  let issues: MermaidIssue[];
  if (args.wikiRoot) {
    issues = lintWikiMermaid(args.wikiRoot);
  } else if (args.page) {
    issues = lintPage(args.page);
  } else {
    process.stdout.write(HELP_TEXT);
    return 0;
  }

  process.stdout.write(JSON.stringify(issues, null, 2) + "\n");
  return 0;
}

// CLI entry point: run main() when this file is executed directly.
const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === thisFile) {
  process.exit(main());
}
