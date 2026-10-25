## 2026-05-14 - Fast-path log parsing

**Learning:** For append-only json log files that grow large over time (like `events.jsonl` in this codebase), reading the whole file line-by-line and unconditionally calling `JSON.parse()` on every line is a significant performance bottleneck.
**Action:** Use a fast-path string `.includes()` check to pre-filter lines that cannot possibly match the required criteria (e.g. `!line.includes('"atlas"')`) before paying the cost of JSON parsing.

## 2026-05-21 - Fast-path timestamp regex optimization

**Learning:** For append-only json log files that grow large over time (like `events.jsonl` in this codebase), reading the whole file line-by-line and unconditionally calling `JSON.parse()` on every line when filtering by `ts` is a significant performance bottleneck.
**Action:** Use an anchored regex (`/^{"ts":"([^"]+)"/`) to extract the timestamp string without JSON parsing, allowing early continue for old logs, before falling back to full JSON parsing for logs inside the window or when the strict format isn't matched.

## 2026-05-22 - Extracting dates via strict regex check

**Learning:** Inner JSON fields might mistakenly contain match substrings like dates (e.g., inside the text of the event). Utilizing a strict, anchored regex check for extracting fields like timestamps directly (`/^{"ts":"([^"\\]+)"/`) avoids both `JSON.parse` overhead and incorrect partial string matches from `String.includes()`.
**Action:** Use an anchored regex (`/^{"ts":"([^"\\]+)"/`) and check the captured group directly before falling back to full JSON parsing.

## 2026-10-25 - [Line Counting Optimization]
**Learning:** In large strings read into memory (e.g., via `fs.readFileSync`), using `.slice(0, idx).split('\n').length` to find the line number for an index allocates multiple massive intermediate arrays and string copies, causing significant memory overhead and sluggishness.
**Action:** Use an iterative `indexOf('\n')` loop to count the newlines without allocating intermediate objects when determining the line number for a specific index in a string.
