## 2026-05-14 - Fast-path log parsing
**Learning:** For append-only json log files that grow large over time (like `events.jsonl` in this codebase), reading the whole file line-by-line and unconditionally calling `JSON.parse()` on every line is a significant performance bottleneck.
**Action:** Use a fast-path string `.includes()` check to pre-filter lines that cannot possibly match the required criteria (e.g. `!line.includes('"atlas"')`) before paying the cost of JSON parsing.

## 2026-05-15 - Fast-path parsing with anchored regex
**Learning:** For fast-path parsing, using `line.includes()` is sometimes fragile and can match inner JSON fields causing data loss if the inner field data unexpectedly changes.
**Action:** Use an anchored regex `/^{"ts":"([^"]+)"/` (or equivalent prefix regex) to ensure you are matching the correct field in the JSON structure at the exact location, without paying the cost of `JSON.parse()`.
