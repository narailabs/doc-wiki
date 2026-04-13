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
export function insertPythonSeparators(raw: string): string {
  let out = "";
  let inString = false;
  let escape = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === undefined) continue;
    out += ch;
    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === "\\") {
        escape = true;
      } else if (ch === '"') {
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
export function pythonJsonDumps(
  obj: unknown,
  indent: number | null = null,
): string {
  if (indent !== null) {
    return JSON.stringify(obj, null, indent);
  }
  const raw = JSON.stringify(obj);
  return insertPythonSeparators(raw);
}

/**
 * Marker for a value that MUST serialize as a Python-style float (i.e. with
 * a trailing `.0` when the numeric value has no fractional part). JavaScript
 * collapses `0.0` and `0` into the same `number`, so `JSON.stringify` emits
 * `0` where Python's `json.dumps` emits `0.0`. Wrapping a value in `pyFloat`
 * tells `pythonJsonDumpsFloats` to expand it back to a decimal literal.
 */
const PY_FLOAT_SENTINEL = "__PY_FLOAT_SENTINEL__";

/** Wrap a number so it serializes as `N.0` when integer-valued.
 *  Used by scripts that must preserve Python's int/float distinction in
 *  their JSON output (e.g. event_logger's `total_cost_usd: 0.0`). */
export function pyFloat(n: number): unknown {
  return { [PY_FLOAT_SENTINEL]: true, value: n };
}

interface PyFloatMarker {
  [PY_FLOAT_SENTINEL]: true;
  value: number;
}

function isPyFloat(v: unknown): v is PyFloatMarker {
  return (
    typeof v === "object" &&
    v !== null &&
    (v as Record<string, unknown>)[PY_FLOAT_SENTINEL] === true
  );
}

/** Recursively unwrap `pyFloat` markers into a placeholder that JSON.stringify
 *  will emit as a string; we then unquote those placeholders to re-emerge as
 *  numeric literals with the required `.0` suffix. */
function preparePyFloats(obj: unknown): unknown {
  if (isPyFloat(obj)) {
    const n = obj.value;
    if (Number.isInteger(n) && Number.isFinite(n)) {
      // Use a unique token; replaced by regex post-stringify.
      return `__PYF_${n}__`;
    }
    return n;
  }
  if (Array.isArray(obj)) {
    return obj.map(preparePyFloats);
  }
  if (obj !== null && typeof obj === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      out[k] = preparePyFloats(v);
    }
    return out;
  }
  return obj;
}

/** Post-pass: replace our `"__PYF_<int>__"` string tokens with `<int>.0`.
 *  The token is ASCII-only and pattern is unambiguous so this is safe even
 *  when user data contains similar-looking substrings — the full pattern
 *  includes the surrounding double quotes. */
function restorePyFloats(raw: string): string {
  return raw.replace(/"__PYF_(-?\d+)__"/g, (_m, n) => `${n}.0`);
}

/**
 * Serialize with Python's separators AND preserve Python-float semantics for
 * values wrapped in `pyFloat()`. Wrapped numbers that are already fractional
 * are emitted normally; wrapped integers emit as `N.0`.
 *
 * Use this for CLI output that must be diff-clean against `json.dumps()`
 * output of a dict containing explicit Python floats (e.g. the `0.0` initial
 * value of `total_cost_usd` in event_logger stats).
 */
export function pythonJsonDumpsFloats(
  obj: unknown,
  indent: number | null = null,
): string {
  const prepared = preparePyFloats(obj);
  let raw: string;
  if (indent !== null) {
    raw = JSON.stringify(prepared, null, indent);
  } else {
    raw = insertPythonSeparators(JSON.stringify(prepared));
  }
  return restorePyFloats(raw);
}
