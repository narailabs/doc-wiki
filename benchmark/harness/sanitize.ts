export interface SanitizeResult {
  text: string;
  redactions: string[];
}

/**
 * Strip references that could leak the real fix to the agent:
 * - `#N` cross-references where N >= the issue's own number (the fix PR is
 *   always opened after the issue);
 * - github pull/issues/commit URLs;
 * - bare commit SHAs (7-40 hex chars);
 * - whole lines containing "fixed/closed/resolved by/in/via".
 * Every removal is logged so the sanitization is auditable.
 */
export function sanitizeIssueBody(body: string, issueNumber: number): SanitizeResult {
  const redactions: string[] = [];
  let text = body;

  text = text.replace(/https:\/\/github\.com\/\S+\/(?:pull|issues|commit)\/\S+/g, (m) => {
    redactions.push(m);
    return "[link-removed]";
  });

  text = text.replace(/(^|[^\w&])#(\d{1,7})\b/g, (m, pre: string, num: string) => {
    if (Number(num) >= issueNumber) {
      redactions.push(`#${num}`);
      return `${pre}#[ref-removed]`;
    }
    return m;
  });

  text = text.replace(/\b[0-9a-f]{7,40}\b/g, (m) => {
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
