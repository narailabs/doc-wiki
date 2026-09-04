## 2026-05-14 - Fast-path log parsing

**Learning:** For append-only json log files that grow large over time (like `events.jsonl` in this codebase), reading the whole file line-by-line and unconditionally calling `JSON.parse()` on every line is a significant performance bottleneck.
**Action:** Use a fast-path string `.includes()` check to pre-filter lines that cannot possibly match the required criteria (e.g. `!line.includes('"atlas"')`) before paying the cost of JSON parsing.

## 2026-05-21 - Fast-path timestamp regex optimization

**Learning:** For append-only json log files that grow large over time (like `events.jsonl` in this codebase), reading the whole file line-by-line and unconditionally calling `JSON.parse()` on every line when filtering by `ts` is a significant performance bottleneck.
**Action:** Use an anchored regex (`/^{"ts":"([^"]+)"/`) to extract the timestamp string without JSON parsing, allowing early continue for old logs, before falling back to full JSON parsing for logs inside the window or when the strict format isn't matched.

## 2026-05-22 - Extracting dates via strict regex check

**Learning:** Inner JSON fields might mistakenly contain match substrings like dates (e.g., inside the text of the event). Utilizing a strict, anchored regex check for extracting fields like timestamps directly (`/^{"ts":"([^"\\]+)"/`) avoids both `JSON.parse` overhead and incorrect partial string matches from `String.includes()`.
**Action:** Use an anchored regex (`/^{"ts":"([^"\\]+)"/`) and check the captured group directly before falling back to full JSON parsing.

## 2026-05-23 - Avoiding split on large log files

**Learning:** Calling `.split('\n')` on large append-only log files (like `events.jsonl` and `_archive_history.jsonl`) allocates a massive intermediate array in memory, causing significant CPU and memory overhead before the data is even processed.
**Action:** Replace `.split('\n')` loops with iterative string scans using `indexOf('\n')` (for forward reading) or `lastIndexOf('\n')` (for reverse reading) combined with `.substring()`. This achieves $O(1)$ memory overhead and enables early exits. When scanning backwards, check for `pos === 0` manually to prevent infinite loops, and remember that `lastIndexOf(str, pos - 1)` covers the character immediately before the current newline.
