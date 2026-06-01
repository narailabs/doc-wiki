## 2026-05-14 - Fast-path log parsing

**Learning:** For append-only json log files that grow large over time (like `events.jsonl` in this codebase), reading the whole file line-by-line and unconditionally calling `JSON.parse()` on every line is a significant performance bottleneck.
**Action:** Use a fast-path string `.includes()` check to pre-filter lines that cannot possibly match the required criteria (e.g. `!line.includes('"atlas"')`) before paying the cost of JSON parsing.

## 2026-05-21 - Fast-path timestamp regex optimization

**Learning:** For append-only json log files that grow large over time (like `events.jsonl` in this codebase), reading the whole file line-by-line and unconditionally calling `JSON.parse()` on every line when filtering by `ts` is a significant performance bottleneck.
**Action:** Use an anchored regex (`/^{"ts":"([^"]+)"/`) to extract the timestamp string without JSON parsing, allowing early continue for old logs, before falling back to full JSON parsing for logs inside the window or when the strict format isn't matched.

## 2026-05-22 - Extracting dates via strict regex check

**Learning:** Inner JSON fields might mistakenly contain match substrings like dates (e.g., inside the text of the event). Utilizing a strict, anchored regex check for extracting fields like timestamps directly (`/^{"ts":"([^"\\]+)"/`) avoids both `JSON.parse` overhead and incorrect partial string matches from `String.includes()`.
**Action:** Use an anchored regex (`/^{"ts":"([^"\\]+)"/`) and check the captured group directly before falling back to full JSON parsing.

## 2026-05-23 - Fast-path false positives with `.includes()`

**Learning:** When using `.includes()` as a fast-path filter before `JSON.parse()`, using loose substrings (e.g., `line.includes("atlas")` or `line.includes(dateStr)`) can cause false positives if those strings appear elsewhere in the JSON body (e.g., inside error messages, URLs, or text fields). This forces the code to fall back to the slow `JSON.parse()` or full regex evaluation unnecessarily, negating the fast-path optimization.
**Action:** Make `.includes()` checks as strict as possible by including JSON structural characters, relying on the predictable output of `JSON.stringify()`. For example, change `line.includes('"atlas"')` to `line.includes('"op":"atlas"')`, and `line.includes(dateStr)` to `line.includes('"ts":"' + dateStr)`.
