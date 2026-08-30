## 2026-05-14 - Fast-path log parsing

**Learning:** For append-only json log files that grow large over time (like `events.jsonl` in this codebase), reading the whole file line-by-line and unconditionally calling `JSON.parse()` on every line is a significant performance bottleneck.
**Action:** Use a fast-path string `.includes()` check to pre-filter lines that cannot possibly match the required criteria (e.g. `!line.includes('"atlas"')`) before paying the cost of JSON parsing.

## 2026-05-21 - Fast-path timestamp regex optimization

**Learning:** For append-only json log files that grow large over time (like `events.jsonl` in this codebase), reading the whole file line-by-line and unconditionally calling `JSON.parse()` on every line when filtering by `ts` is a significant performance bottleneck.
**Action:** Use an anchored regex (`/^{"ts":"([^"]+)"/`) to extract the timestamp string without JSON parsing, allowing early continue for old logs, before falling back to full JSON parsing for logs inside the window or when the strict format isn't matched.

## 2026-05-22 - Extracting dates via strict regex check

**Learning:** Inner JSON fields might mistakenly contain match substrings like dates (e.g., inside the text of the event). Utilizing a strict, anchored regex check for extracting fields like timestamps directly (`/^{"ts":"([^"\\]+)"/`) avoids both `JSON.parse` overhead and incorrect partial string matches from `String.includes()`.
**Action:** Use an anchored regex (`/^{"ts":"([^"\\]+)"/`) and check the captured group directly before falling back to full JSON parsing.
<<<<<<< HEAD

## 2026-05-22 - Fast-path exact string matching optimization

**Learning:** For append-only json log files that grow large over time (like `events.jsonl`), pre-filtering with `line.includes('"atlas"')` is not specific enough and might cause unnecessary `JSON.parse` operations if "atlas" appears elsewhere in the JSON. Keying on the `op` field instead is specific, and the closing quote is what makes it safe: `"op":"atlas"` cannot false-positive against a longer op name such as `atlas-cross-service`, because the longer name's serialization has no quote in that position.
**Action:** Pre-filter on the `op` field with the closing quote included, and match the separator with `/"op":\s?"atlas"/` rather than a literal `line.includes('"op":"atlas"')`. `JSON.stringify` (what `event_logger.ts` writes) emits no space after the colon, but `events.jsonl` files still carry lines from the historical Python `json.dumps` writer, which emitted `"op": "atlas"`. A literal compact-only check silently drops those older events. The same shape applies to the other filters (`'"error"'`, `'"failed"'`).
=======
## 2025-02-19 - Avoid synchronous allocation of intermediate arrays for append-only logs
**Learning:** When parsing large append-only JSON logs, reading into memory via `fs.readFileSync` and `.split("\n")` synchronously allocates a massive intermediate array.
**Action:** Replace `.split("\n")` with an iterative `lastIndexOf("\n")` loop for backwards traversal (or `indexOf` for forwards traversal) and use `substring()` to avoid creating an intermediate array.
>>>>>>> 896e39d
