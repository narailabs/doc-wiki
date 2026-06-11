export interface SanitizeResult {
  text: string;
  redactions: string[];
}

/**
 * Strip PR-template boilerplate from a PR description before it becomes a problem
 * statement. PR bodies (unlike issue bodies) commonly carry repo PR-template scaffolding
 * (e.g. saleor/saleor) that is pure noise and could leak harness/context hints:
 * - multiline HTML comments `<!-- ... -->` (template instructions);
 * - a trailing "# Impact" / changelog section and everything after it;
 * - GitHub-flavoured checklist lines (`- [ ]` / `- [x]`).
 * The remaining substantive text is collapsed (no 3+ blank-line runs) and trimmed.
 * Applied in the PR ticket path BEFORE sanitizeIssueBody; the issue path is untouched.
 */
export function stripPrTemplate(body: string): string {
  let text = body.replace(/<!--[\s\S]*?-->/g, "");
  // Drop a "# Impact" (or "## Impact" ...) heading and everything after it.
  text = text.replace(/^#{1,6}\s+Impact\b[\s\S]*$/im, "");
  // Drop any remaining task-list checklist lines (template acknowledgement boxes).
  text = text.replace(/^[ \t]*[-*]\s+\[[ xX]\].*$/gm, "");
  // Collapse 3+ newline runs to a paragraph break, trim trailing whitespace per line, trim ends.
  text = text
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text;
}

/**
 * Strip references that could leak the real fix to the agent:
 * - `#N`, `owner/repo#N`, and `GH-N` cross-references where N >= the issue's
 *   own number (the fix PR is always opened after the issue);
 * - github pull/issues/commit URLs (http or https);
 * - bare commit SHAs (7-40 hex chars, case-insensitive, at least one hex letter);
 * - whole lines containing "fixed/closed/resolved by/in/via".
 * Every removal is logged so the sanitization is auditable.
 */
export function sanitizeIssueBody(body: string, issueNumber: number): SanitizeResult {
  const redactions: string[] = [];
  let text = body;

  text = text.replace(/https?:\/\/github\.com\/[^\s)]+\/(?:pull|issues|commit)\/[^\s.,)]+/g, (m) => {
    redactions.push(m);
    return "[link-removed]";
  });

  text = text.replace(/\b[\w.-]+\/[\w.-]+#(\d{1,7})\b/g, (m, num: string) => {
    if (Number(num) >= issueNumber) {
      redactions.push(m);
      return "[ref-removed]";
    }
    return m;
  });

  text = text.replace(/(^|[^\w&])#(\d{1,7})\b/g, (m, pre: string, num: string) => {
    if (Number(num) >= issueNumber) {
      redactions.push(`#${num}`);
      return `${pre}#[ref-removed]`;
    }
    return m;
  });

  text = text.replace(/\bGH-(\d{1,7})\b/gi, (m, num: string) => {
    if (Number(num) >= issueNumber) {
      redactions.push(m);
      return "GH-[ref-removed]";
    }
    return m;
  });

  text = text.replace(/\b(?=[0-9a-fA-F]*[a-fA-F])[0-9a-fA-F]{7,40}\b/g, (m) => {
    redactions.push(m);
    return "[sha-removed]";
  });

  text = text
    .split("\n")
    .map((line) => {
      if (/\b(?:fixed|closed|resolved)\s+(?:by|in|via)\b/i.test(line)) {
        redactions.push(line.trim());
        return "[line-removed]";
      }
      return line;
    })
    .join("\n");

  return { text, redactions };
}
