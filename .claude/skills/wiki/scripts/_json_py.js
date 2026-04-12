/**
 * Shared JSON serialization helpers that match Python's json.dumps output
 * byte-for-byte, so CLI stdout produced by our TypeScript ports is diff-clean
 * against the Python reference.
 *
 * Python's json.dumps defaults to ", " and ": " separators, whereas
 * Node's JSON.stringify uses "," and ":". These helpers bridge that gap.
 */
/**
 * Insert Python-style ", " and ": " separators into a JSON string produced
 * by JSON.stringify (which uses "," and ":"). Skips bytes inside string
 * literals so separators within quoted values are not touched.
 *
 * Exported for unit tests; callers normally want pythonJsonDumps().
 */
export function insertPythonSeparators(raw) {
    let out = "";
    let inString = false;
    let escape = false;
    for (let i = 0; i < raw.length; i++) {
        const ch = raw[i];
        if (ch === undefined)
            continue;
        out += ch;
        if (inString) {
            if (escape) {
                escape = false;
            }
            else if (ch === "\\") {
                escape = true;
            }
            else if (ch === '"') {
                inString = false;
            }
            continue;
        }
        if (ch === '"') {
            inString = true;
            continue;
        }
        if (ch === "," || ch === ":") {
            out += " ";
        }
    }
    return out;
}
/**
 * Serialize a value to JSON using Python's default json.dumps separators.
 *
 * - When `indent` is null (the default), emits compact form with Python's
 *   ", " and ": " separators instead of Node's "," and ":".
 * - When `indent` is a number, delegates to JSON.stringify with that indent;
 *   this matches Python's indented output format exactly for the shapes the
 *   wiki scripts emit.
 */
export function pythonJsonDumps(obj, indent = null) {
    if (indent !== null) {
        return JSON.stringify(obj, null, indent);
    }
    const raw = JSON.stringify(obj);
    return insertPythonSeparators(raw);
}
