import * as yaml from "js-yaml";

export interface ResolutionContext {
  /** Flattened config key → value (e.g. "payments-service.url" → "http://..."). */
  properties: Map<string, string>;
  /** Constant identifier → literal (e.g. "QUEUE_TASK" → "task-orchestrator"). */
  constants: Map<string, string>;
}

/** Flatten a YAML doc into dotted keys. Handles nested maps + scalar leaves.
 *  Arrays and complex scalars are ignored (precision bias). */
function flattenYaml(obj: unknown, prefix: string, out: Map<string, string>): void {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object") flattenYaml(v, key, out);
    else if (typeof v === "string" || typeof v === "number") out.set(key, String(v));
  }
}

/**
 * @param configFiles  map of repo-relative path → content for application*.{yml,yaml,properties}
 * @param sourceFiles  map of repo-relative path → content for source files holding const decls
 */
export function buildResolutionContext(
  configFiles: Record<string, string>,
  sourceFiles: Record<string, string>,
): ResolutionContext {
  const properties = new Map<string, string>();
  for (const [file, content] of Object.entries(configFiles)) {
    if (/\.(ya?ml)$/.test(file)) {
      try { flattenYaml(yaml.load(content), "", properties); } catch { /* skip */ }
    } else if (/\.properties$/.test(file)) {
      for (const line of content.split("\n")) {
        if (line.trimStart().startsWith("#")) continue;
        const m = line.match(/^\s*([\w.-]+)\s*=\s*(.+?)\s*$/);
        if (m && m[1] != null && m[2] != null) properties.set(m[1], m[2]);
      }
    }
  }
  const constants = new Map<string, string>();
  // static final String NAME = "literal";  (Java)   |   const NAME = "literal"  (TS/JS)
  const constRe = /(?:static\s+final\s+\w+|const|final\s+\w+)\s+(\w+)\s*=\s*["']([^"']+)["']/g;
  for (const content of Object.values(sourceFiles)) {
    let m: RegExpExecArray | null;
    constRe.lastIndex = 0;
    while ((m = constRe.exec(content)) !== null) {
      if (m[1] != null && m[2] != null) constants.set(m[1], m[2]);
    }
  }
  return { properties, constants };
}

/**
 * Resolve a reference to a literal. Handles:
 *   - `${key}` or `${key}/suffix` → property value (+ suffix)
 *   - `CONST` (UPPER_SNAKE) → constant value
 *   - a plain literal (no `${}`/interpolation) → returned as-is
 * Returns undefined when unresolvable (caller downgrades to medium/low/skip).
 */
export function resolveRef(ref: string, ctx: ResolutionContext): string | undefined {
  const placeholder = ref.match(/^\$\{([\w.-]+)\}(.*)$/);
  if (placeholder) {
    const key = placeholder[1] ?? "";
    const suffix = placeholder[2] ?? "";
    const base = ctx.properties.get(key);
    return base === undefined ? undefined : base + suffix;
  }
  if (/^[A-Z][A-Z0-9_]*$/.test(ref)) {           // looks like a CONST
    return ctx.constants.get(ref);
  }
  if (ref.includes("${") || ref.includes("`")) return undefined;  // unresolved interpolation
  // Bare identifiers (word-chars only) can't be verified as literals — precision bias.
  if (/^\w+$/.test(ref)) return undefined;
  return ref.length > 0 ? ref : undefined;        // plain literal (contains URL/path chars)
}
