#!/usr/bin/env node
// ── Constants ───────────────────────────────────────────────────────
export const MARKER_START = "<!-- wiki-managed: quickstart start -->";
export const MARKER_END = "<!-- wiki-managed: quickstart end -->";
const INSTALL_HEADINGS = [
    /^##\s+install\s*$/im,
    /^##\s+installation\s*$/im,
    /^##\s+setup\s*$/im,
    /^##\s+get\s+started\s*$/im,
    /^##\s+getting\s+started\s*$/im,
];
// ── Errors ──────────────────────────────────────────────────────────
export class MarkersMissingError extends Error {
    error_code = "MARKERS_MISSING";
    constructor() {
        super(`README has no wiki-managed quickstart markers. Run with action: "init" to insert them.`);
        this.name = "MarkersMissingError";
    }
}
export class MarkersCorruptError extends Error {
    error_code = "MARKERS_CORRUPT";
    starts;
    ends;
    constructor(starts, ends) {
        super(`Corrupted wiki-managed quickstart markers: ${starts} start marker(s) and ${ends} end marker(s) (expected exactly 1 of each).`);
        this.name = "MarkersCorruptError";
        this.starts = starts;
        this.ends = ends;
    }
}
function countOccurrences(haystack, needle) {
    if (needle.length === 0)
        return 0;
    let count = 0;
    let i = 0;
    while (true) {
        const hit = haystack.indexOf(needle, i);
        if (hit < 0)
            break;
        count++;
        i = hit + needle.length;
    }
    return count;
}
export function extractMarkerBlock(readme) {
    const starts = countOccurrences(readme, MARKER_START);
    const ends = countOccurrences(readme, MARKER_END);
    if (starts === 0 && ends === 0)
        throw new MarkersMissingError();
    if (starts !== 1 || ends !== 1)
        throw new MarkersCorruptError(starts, ends);
    const sIdx = readme.indexOf(MARKER_START);
    const eIdx = readme.indexOf(MARKER_END);
    if (eIdx < sIdx)
        throw new MarkersCorruptError(starts, ends);
    // before: everything up to (not including) the start marker
    // after: everything after (not including) the end marker
    const before = readme.substring(0, sIdx);
    const innerStart = sIdx + MARKER_START.length;
    const eEnd = eIdx + MARKER_END.length;
    const inner = readme.substring(innerStart, eIdx);
    const between = inner.replace(/^\n/, "").replace(/\n$/, "");
    const after = readme.substring(eEnd);
    return { before, between, after };
}
export function replaceMarkerBlock(readme, newBlock) {
    const { before, after } = extractMarkerBlock(readme);
    return `${before}${MARKER_START}\n${newBlock}\n${MARKER_END}${after}`;
}
export function insertMarkers(readme, placeholder) {
    let anchorIdx = -1;
    let anchorLineEnd = -1;
    for (const re of INSTALL_HEADINGS) {
        const m = re.exec(readme);
        if (m) {
            anchorIdx = m.index;
            anchorLineEnd = readme.indexOf("\n", anchorIdx);
            if (anchorLineEnd < 0)
                anchorLineEnd = readme.length;
            break;
        }
    }
    if (anchorIdx === -1) {
        // Fallback: first ## heading
        const m = /^##\s+/m.exec(readme);
        if (!m) {
            // Last resort: append at the end
            return `${readme}\n${MARKER_START}\n${placeholder}\n${MARKER_END}\n`;
        }
        anchorLineEnd = readme.indexOf("\n", m.index);
        if (anchorLineEnd < 0)
            anchorLineEnd = readme.length;
    }
    const insertion = `\n\n${MARKER_START}\n${placeholder}\n${MARKER_END}`;
    return (readme.substring(0, anchorLineEnd) +
        insertion +
        readme.substring(anchorLineEnd));
}
// ── CLI ─────────────────────────────────────────────────────────────
// (CLI dispatch added in Task 3.)
