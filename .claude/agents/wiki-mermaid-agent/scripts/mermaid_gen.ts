#!/usr/bin/env node
/**
 * Convert agent output JSON with mermaid fields into fenced Mermaid code blocks.
 *
 * Takes agent output JSON containing a ``mermaid`` field and generates
 * properly fenced mermaid code blocks for wiki pages.
 *
 * Library usage:
 *     import { formatMermaidBlock, injectMermaid } from "./mermaid_gen.js";
 *     const block = formatMermaidBlock({ type: "erDiagram", title: "...", code: "..." });
 *     const page = injectMermaid(pageContent, [block]);
 *
 * CLI usage:
 *     node mermaid_gen.js --input agent_output.json
 *     node mermaid_gen.js --input agent_output.json --page wiki/db/schema.md
 *
 * This is a TypeScript port of mermaid_gen.py; behaviour matches the
 * Python reference byte-for-byte for the same inputs.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

// ── Constants ───────────────────────────────────────────────────────

export const SUPPORTED_TYPES: ReadonlySet<string> = new Set([
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

/** Matches Python's `re.compile(r"^(graph|flowchart)\s+(TD|TB|BT|RL|LR)$")` —
 *  accepts directional modifiers on `graph`/`flowchart` diagram types. */
const _TYPE_WITH_DIRECTION = /^(graph|flowchart)\s+(TD|TB|BT|RL|LR)$/;

// ── Library API ────────────────────────────────────────────────────

/** Shape of mermaid data expected by `formatMermaidBlock`. */
export interface MermaidData {
  type?: string;
  title?: string;
  code?: string;
}

/**
 * Format a mermaid data dict into a fenced code block.
 *
 * `mermaidData` must have keys `type`, `code`, and optionally `title`.
 *
 * Returns a string like:
 *
 *     %% Title: User Orders
 *     ```mermaid
 *     erDiagram
 *         users ||--o{ orders : has
 *     ```
 */
export function formatMermaidBlock(mermaidData: MermaidData): string {
  const diagramType = mermaidData.type ?? "";
  const title = mermaidData.title ?? "";
  const code = mermaidData.code ?? "";

  const lines: string[] = [];
  if (title) {
    lines.push(`%% Title: ${title}`);
  }
  lines.push("```mermaid");
  lines.push(diagramType);
  lines.push(code);
  lines.push("```");
  return lines.join("\n");
}

function escapeRegex(s: string): string {
  return s.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
}

/**
 * Inject mermaid blocks into page content under a section heading.
 *
 * If the page already has a section matching `section`, that section is
 * replaced (up to the next `##` heading or end of file). Otherwise the
 * section is appended at the end.
 */
export function injectMermaid(
  pageContent: string,
  mermaidBlocks: readonly string[],
  section: string = "## Diagrams",
): string {
  const blocksText = mermaidBlocks.join("\n\n");
  const newSection = `${section}\n\n${blocksText}\n`;

  // Python: `re.compile(escape(section) + r"\n.*?(?=\n## |\Z)", re.DOTALL)`
  // The `\Z` anchor matches end-of-string in Python; in JS we can emulate
  // by using `(?=\n## |$)` with the `s` flag, but `$` needs `m` to match
  // line-end rather than string-end. To preserve exact Python semantics we
  // slice manually: find the section, look ahead for the next `\n## `.
  const escaped = escapeRegex(section);
  const pattern = new RegExp(escaped + "\\n[\\s\\S]*?(?=\\n## |$)", "");

  if (pattern.test(pageContent)) {
    // Reset state to avoid lastIndex carry-over.
    pattern.lastIndex = 0;
    return pageContent.replace(pattern, newSection);
  }

  let result = pageContent;
  if (result && !result.endsWith("\n")) {
    result += "\n";
  }
  if (result) {
    return `${result}\n${newSection}`;
  }
  return newSection;
}

/**
 * Extract mermaid entries from agent JSON output.
 *
 * Looks for a `mermaid` key that contains a list of dicts, each with
 * `type`, `title`, and `code` keys.
 *
 * Returns an empty list if no mermaid field is found.
 */
export function extractMermaidFromOutput(
  agentOutput: Record<string, unknown>,
): MermaidData[] {
  const mermaid = agentOutput["mermaid"];
  if (!Array.isArray(mermaid)) {
    return [];
  }
  return [...mermaid] as MermaidData[];
}

/**
 * Check if a diagram type is supported. Handles types with direction
 * suffixes (e.g. `graph TD`).
 */
export function validateMermaidType(diagramType: string): boolean {
  if (!diagramType) return false;
  if (SUPPORTED_TYPES.has(diagramType)) return true;
  return _TYPE_WITH_DIRECTION.test(diagramType);
}

// ── CLI ─────────────────────────────────────────────────────────────

interface ParsedArgs {
  input?: string;
  page?: string;
  help?: boolean;
}

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
      case "input":
        out.input = value ?? "";
        break;
      case "page":
        out.page = value ?? "";
        break;
      default:
        throw new Error(`unrecognized argument: --${name}`);
    }
  }
  return out;
}

const HELP_TEXT = `usage: mermaid_gen.js [-h] --input INPUT [--page PAGE]

Generate fenced Mermaid blocks from agent output JSON.

options:
  -h, --help            show this help message and exit
  --input INPUT         Path to agent output JSON file
  --page PAGE           Path to wiki page file for injection (updates in-place)
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

  if (!args.input) {
    process.stderr.write("the following arguments are required: --input\n");
    return 2;
  }

  const raw = fs.readFileSync(args.input, { encoding: "utf-8" });
  const parsed: unknown = JSON.parse(raw);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    process.stderr.write("agent output must be a JSON object\n");
    return 1;
  }
  const mermaidEntries = extractMermaidFromOutput(
    parsed as Record<string, unknown>,
  );

  if (mermaidEntries.length === 0) {
    process.stdout.write("No mermaid entries found in agent output.\n");
    return 0;
  }

  const blocks = mermaidEntries.map((entry) => formatMermaidBlock(entry));

  if (args.page) {
    let content = "";
    if (fs.existsSync(args.page)) {
      content = fs.readFileSync(args.page, { encoding: "utf-8" });
    }
    const result = injectMermaid(content, blocks);
    fs.writeFileSync(args.page, result);
    process.stdout.write(
      `Injected ${blocks.length} mermaid block(s) into ${args.page}\n`,
    );
  } else {
    process.stdout.write(blocks.join("\n\n") + "\n");
  }
  return 0;
}

const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === thisFile) {
  process.exit(main());
}
