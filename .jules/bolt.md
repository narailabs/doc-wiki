## 2026-05-14 - Fast-path log parsing

**Learning:** For append-only json log files that grow large over time (like `events.jsonl` in this codebase), reading the whole file line-by-line and unconditionally calling `JSON.parse()` on every line is a significant performance bottleneck.
**Action:** Use a fast-path string `.includes()` check to pre-filter lines that cannot possibly match the required criteria (e.g. `!line.includes('"atlas"')`) before paying the cost of JSON parsing.

## 2026-05-21 - Fast-path timestamp regex optimization

**Learning:** For append-only json log files that grow large over time (like `events.jsonl` in this codebase), reading the whole file line-by-line and unconditionally calling `JSON.parse()` on every line when filtering by `ts` is a significant performance bottleneck.
**Action:** Use an anchored regex (`/^{"ts":"([^"]+)"/`) to extract the timestamp string without JSON parsing, allowing early continue for old logs, before falling back to full JSON parsing for logs inside the window or when the strict format isn't matched.

## 2026-05-22 - Extracting dates via strict regex check

**Learning:** Inner JSON fields might mistakenly contain match substrings like dates (e.g., inside the text of the event). Utilizing a strict, anchored regex check for extracting fields like timestamps directly (`/^{"ts":"([^"\\]+)"/`) avoids both `JSON.parse` overhead and incorrect partial string matches from `String.includes()`.
**Action:** Use an anchored regex (`/^{"ts":"([^"\\]+)"/`) and check the captured group directly before falling back to full JSON parsing.

## 2024-08-14 - Prevent synchronous massive array allocation from string splits
**Learning:** In a codebase that parses extremely large, append-only JSON files (`events.jsonl`) multiple times backwards from the end to find the most recent matching event, executing `.split('\n')` on the entire file contents allocated massive intermediate arrays, blocking the Node main thread and creating enormous garbage collection overhead.
**Action:** Replace `const lines = raw.split("\n"); for (let i = lines.length -1...)` with an iterative `lastIndexOf("\n")` loop and `substring` to fetch strings segment-by-segment exactly as they are needed backwards. Since there are frequently early returns (e.g., retrieving sample chunks or the latest run log), this scales better than processing the entire string initially.
