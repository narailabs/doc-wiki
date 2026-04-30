/**
 * Shared YAML frontmatter parser.
 *
 * Both `lint_checks.ts` and `quality_score.ts` previously hand-rolled this
 * exact same logic (with slightly different return shapes). This module owns
 * the canonical implementation; callers project the result down to whichever
 * shape they need.
 *
 * Parity rule (matches Python `_parse_frontmatter` in both source files):
 *   - Content MUST start with `---\n`.
 *   - A trailing `\n---\n` MUST appear later.
 *   - Anything else (no delimiters, malformed YAML, non-dict YAML) yields
 *     `{ frontmatter: null, body: content }` where the body is the original
 *     unmodified content. Callers convert `null` -> `{}` if they only care
 *     about the dict.
 *   - On success, the body is everything after the closing `\n---\n` (length
 *     5), with no leading-newline trimming — matching Python's `[end + 5 :]`
 *     slice.
 */
import * as yaml from "js-yaml";

export interface FrontmatterResult {
  /** Parsed frontmatter dict, or `null` when the page has none / is malformed. */
  frontmatter: Record<string, unknown> | null;
  /** Page body. Equals the original content when frontmatter is `null`. */
  body: string;
}

/**
 * Split `content` into a frontmatter dict and body string using Python's
 * strict delimiter rules. See module docstring for parity details.
 */
export function parseFrontmatter(content: string): FrontmatterResult {
  if (!content.startsWith("---\n")) {
    return { frontmatter: null, body: content };
  }
  const end = content.indexOf("\n---\n", 4);
  if (end === -1) {
    return { frontmatter: null, body: content };
  }
  const fmStr = content.slice(4, end);
  const body = content.slice(end + 5);
  let parsed: unknown;
  try {
    parsed = yaml.load(fmStr);
  } catch {
    return { frontmatter: null, body: content };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { frontmatter: null, body: content };
  }
  return { frontmatter: parsed as Record<string, unknown>, body };
}
