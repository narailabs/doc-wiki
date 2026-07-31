## 2026-05-14 - Fast-path log parsing

**Learning:** For append-only json log files that grow large over time (like `events.jsonl` in this codebase), reading the whole file line-by-line and unconditionally calling `JSON.parse()` on every line is a significant performance bottleneck.
**Action:** Use a fast-path string `.includes()` check to pre-filter lines that cannot possibly match the required criteria (e.g. `!line.includes('"atlas"')`) before paying the cost of JSON parsing.

## 2026-05-21 - Fast-path timestamp regex optimization

**Learning:** For append-only json log files that grow large over time (like `events.jsonl` in this codebase), reading the whole file line-by-line and unconditionally calling `JSON.parse()` on every line when filtering by `ts` is a significant performance bottleneck.
**Action:** Use an anchored regex (`/^{"ts":"([^"]+)"/`) to extract the timestamp string without JSON parsing, allowing early continue for old logs, before falling back to full JSON parsing for logs inside the window or when the strict format isn't matched.

## 2026-05-22 - Extracting dates via strict regex check

**Learning:** Inner JSON fields might mistakenly contain match substrings like dates (e.g., inside the text of the event). Utilizing a strict, anchored regex check for extracting fields like timestamps directly (`/^{"ts":"([^"\\]+)"/`) avoids both `JSON.parse` overhead and incorrect partial string matches from `String.includes()`.
**Action:** Use an anchored regex (`/^{"ts":"([^"\\]+)"/`) and check the captured group directly before falling back to full JSON parsing.

## 2026-07-31 - Iterating backwards over massive strings without .split('\n')

**Learning:** When processing large files read into memory as a single string (e.g., `fs.readFileSync("events.jsonl", "utf-8")`), using `.split('\n')` is highly inefficient because it synchronously allocates a massive intermediate array. This increases memory overhead unnecessarily, especially when you only need to process a few recent lines backwards.
**Action:** Use an iterative approach with `lastIndexOf('\n')` combined with `substring()` to traverse backwards without allocating an array for every line. Remember to handle index 0 specifically to prevent infinite loops (e.g., `const prevPos = pos === 0 ? -1 : str.lastIndexOf('\n', pos - 1);`).
