#!/usr/bin/env node
/**
 * mermaid_inject.ts — splice agent-emitted Mermaid blocks into a page body.
 *
 * Per v2 design §17 + diag Path G (cross-referencing compilation), every
 * source / mapper agent that produces diagram-worthy structured data can
 * return a `mermaid` field in its JSON output:
 *
 *   { "status": "success",
 *     "data": { ... },
 *     "mermaid": { "type": "erDiagram",
 *                  "title": "User service ERD",
 *                  "code": "erDiagram\n    ..." } }
 *
 * During `/doc-wiki:ingest` step 9 the compiler gathers those outputs from
 * parallel agent dispatches and splices each diagram into the compiled
 * page as a fenced code block under a matching `## <title>` heading.
 * Before this module the splicing was LLM judgment; now it is
 * deterministic — same outputs give the same page bytes.
 *
 * Idempotence:
 *   Each block is wrapped in HTML-comment markers
 *   `<!-- wiki-mermaid: <title> start -->` / `... end -->`. Re-running
 *   the injector with an updated `mermaid.code` for the same title
 *   replaces the block in-place instead of stacking duplicates. New
 *   titles are appended at the end, separated by a blank line.
 *
 * Usage as a library:
 *     import { injectMermaidBlocks } from "./mermaid_inject.js";
 *     const body = injectMermaidBlocks(pageBody, agentOutputs);
 *
 * Usage as a CLI:
 *     node mermaid_inject.js --page wiki/topic/page.md --agents outputs.json
 *     # --agents points at a JSON array of agent-output envelopes.
 *     # --in-place rewrites the page; otherwise the new body is on stdout.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { parseFlags } from "./_cli_args.js";
/** Marker builders; shared with tests so the invariants stay in one place. */
export function startMarker(title) {
    return `<!-- wiki-mermaid: ${title} start -->`;
}
export function endMarker(title) {
    return `<!-- wiki-mermaid: ${title} end -->`;
}
function renderBlock(block) {
    const lines = [];
    lines.push(startMarker(block.title));
    lines.push(`## ${block.title}`);
    lines.push("");
    lines.push("```mermaid");
    lines.push(block.code.replace(/\s+$/, ""));
    lines.push("```");
    lines.push(endMarker(block.title));
    return lines.join("\n");
}
/**
 * Replace the first existing wrapped block with the same title, or
 * return `null` when no such block is present. Keeps whitespace above
 * and below the block unchanged.
 */
function replaceBlock(body, block) {
    const start = startMarker(block.title);
    const end = endMarker(block.title);
    const sIdx = body.indexOf(start);
    if (sIdx < 0)
        return null;
    const eIdx = body.indexOf(end, sIdx + start.length);
    if (eIdx < 0)
        return null;
    const before = body.slice(0, sIdx);
    const after = body.slice(eIdx + end.length);
    return before + renderBlock(block) + after;
}
/** Append a new block to the body, separated by a single blank line. */
function appendBlock(body, block) {
    const trimmed = body.replace(/\s+$/, "");
    const prefix = trimmed === "" ? "" : trimmed + "\n\n";
    return prefix + renderBlock(block) + "\n";
}
/** Extract valid MermaidBlock envelopes from agent outputs, preserving order. */
function extractBlocks(outputs) {
    const blocks = [];
    for (const out of outputs) {
        const m = out?.mermaid;
        if (m === undefined || m === null)
            continue;
        if (typeof m.type !== "string" ||
            typeof m.title !== "string" ||
            typeof m.code !== "string") {
            continue;
        }
        const title = m.title.trim();
        const code = m.code.trim();
        const type = m.type.trim();
        if (title === "" || code === "" || type === "")
            continue;
        blocks.push({ type, title, code });
    }
    return blocks;
}
/**
 * Splice Mermaid blocks emitted by dispatched agents into `pageBody`.
 * For each block:
 *   - If a wrapped block with the same title already exists, replace it.
 *   - Otherwise append at the end.
 * Agent outputs without a well-formed `mermaid` field are ignored.
 */
export function injectMermaidBlocks(pageBody, agentOutputs) {
    let body = pageBody;
    for (const block of extractBlocks(agentOutputs)) {
        const replaced = replaceBlock(body, block);
        body = replaced !== null ? replaced : appendBlock(body, block);
    }
    return body;
}
// ── CLI ────────────────────────────────────────────────────────────
const FLAG_SPEC = {
    "--page": "page",
    "--agents": "agents",
    "--in-place": "inPlace",
};
const HELP_TEXT = `usage: mermaid_inject.js --page PAGE --agents AGENTS [--in-place]

Splice agent-emitted Mermaid blocks into a wiki page body.

arguments:
  --page PAGE       Path to the markdown page to modify
  --agents AGENTS   Path to a JSON file containing an array of agent
                    output envelopes ({ mermaid?: {type,title,code} })
  --in-place        Rewrite PAGE in place. Without this flag, the new
                    body is written to stdout and PAGE is untouched.
options:
  -h, --help        show this help message and exit
`;
function loadAgents(file) {
    const raw = fs.readFileSync(file, { encoding: "utf-8" });
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
        throw new Error(`--agents file must contain a JSON array, got ${typeof parsed}`);
    }
    return parsed;
}
export function main(argv = process.argv.slice(2)) {
    if (argv[0] === "-h" || argv[0] === "--help") {
        process.stdout.write(HELP_TEXT);
        return 0;
    }
    let parsed;
    try {
        parsed = parseFlags(argv, FLAG_SPEC);
    }
    catch (e) {
        process.stderr.write(`${e.message}\n`);
        return 2;
    }
    if (parsed.help) {
        process.stdout.write(HELP_TEXT);
        return 0;
    }
    const pagePath = parsed.values["page"];
    const agentsPath = parsed.values["agents"];
    if (typeof pagePath !== "string" || pagePath === "") {
        process.stderr.write("the following arguments are required: --page\n");
        return 2;
    }
    if (typeof agentsPath !== "string" || agentsPath === "") {
        process.stderr.write("the following arguments are required: --agents\n");
        return 2;
    }
    let body;
    try {
        body = fs.readFileSync(pagePath, { encoding: "utf-8" });
    }
    catch (e) {
        process.stderr.write(`could not read --page: ${e.message}\n`);
        return 2;
    }
    let agents;
    try {
        agents = loadAgents(agentsPath);
    }
    catch (e) {
        process.stderr.write(`could not parse --agents: ${e.message}\n`);
        return 2;
    }
    const next = injectMermaidBlocks(body, agents);
    if (parsed.values["inPlace"] !== undefined) {
        fs.writeFileSync(pagePath, next);
    }
    else {
        process.stdout.write(next);
    }
    return 0;
}
const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === thisFile) {
    process.exit(main());
}
