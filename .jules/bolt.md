## 2026-05-14 - Fast-path log parsing

**Learning:** For append-only json log files that grow large over time (like `events.jsonl` in this codebase), reading the whole file line-by-line and unconditionally calling `JSON.parse()` on every line is a significant performance bottleneck.
**Action:** Use a fast-path string `.includes()` check to pre-filter lines that cannot possibly match the required criteria (e.g. `!line.includes('"atlas"')`) before paying the cost of JSON parsing.

## 2026-05-21 - Fast-path timestamp regex optimization

**Learning:** For append-only json log files that grow large over time (like `events.jsonl` in this codebase), reading the whole file line-by-line and unconditionally calling `JSON.parse()` on every line when filtering by `ts` is a significant performance bottleneck.
**Action:** Use an anchored regex (`/^{"ts":"([^"]+)"/`) to extract the timestamp string without JSON parsing, allowing early continue for old logs, before falling back to full JSON parsing for logs inside the window or when the strict format isn't matched.

## 2026-05-22 - Extracting dates via strict regex check

**Learning:** Inner JSON fields might mistakenly contain match substrings like dates (e.g., inside the text of the event). Utilizing a strict, anchored regex check for extracting fields like timestamps directly (`/^{"ts":"([^"\\]+)"/`) avoids both `JSON.parse` overhead and incorrect partial string matches from `String.includes()`.
**Action:** Use an anchored regex (`/^{"ts":"([^"\\]+)"/`) and check the captured group directly before falling back to full JSON parsing.

## 2026-05-23 - Hoisting Regex for Log Filtering

**Learning:** When pre-filtering large, append-only json log streams (like `events.jsonl`) using regex checks (e.g., `/^{"ts":"([^"\\]+)"/`), instantiating `new RegExp()` or using literal regex definitions inside loops adds significant overhead that can diminish the performance benefits of bypassing `JSON.parse()`.
**Action:** Hoist the regex literals outside of the reading loop (e.g., as a global constant `const TS_RE = ...;`) to ensure compilation happens only once, maximizing the speed of the `.exec()` fast-path check. However, be careful not to mistake substring check `.includes()` (which is significantly faster than regex) as something to replace with regex `.test()`; only hoist literal regex definitions to regex variables for `.exec()` or `.test()` calls.
