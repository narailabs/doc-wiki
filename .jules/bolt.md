## 2026-05-14 - Fast-path log parsing

**Learning:** For append-only json log files that grow large over time (like `events.jsonl` in this codebase), reading the whole file line-by-line and unconditionally calling `JSON.parse()` on every line is a significant performance bottleneck.
**Action:** Use a fast-path string `.includes()` check to pre-filter lines that cannot possibly match the required criteria (e.g. `!line.includes('"atlas"')`) before paying the cost of JSON parsing.

## 2026-05-21 - Fast-path timestamp regex optimization

**Learning:** For append-only json log files that grow large over time (like `events.jsonl` in this codebase), reading the whole file line-by-line and unconditionally calling `JSON.parse()` on every line when filtering by `ts` is a significant performance bottleneck.
**Action:** Use an anchored regex (`/^{"ts":"([^"]+)"/`) to extract the timestamp string without JSON parsing, allowing early continue for old logs, before falling back to full JSON parsing for logs inside the window or when the strict format isn't matched.

## 2026-05-22 - Extracting dates via strict regex check

**Learning:** Inner JSON fields might mistakenly contain match substrings like dates (e.g., inside the text of the event). Utilizing a strict, anchored regex check for extracting fields like timestamps directly (`/^{"ts":"([^"\\]+)"/`) avoids both `JSON.parse` overhead and incorrect partial string matches from `String.includes()`.
**Action:** Use an anchored regex (`/^{"ts":"([^"\\]+)"/`) and check the captured group directly before falling back to full JSON parsing.

## 2026-05-23 - Hoist fast-path regex and use `.exec()`

**Learning:** While modern V8 engines are good at optimizing literal regexes in loops, using `String.prototype.match()` with an inline literal still carries a setup overhead compared to `RegExp.prototype.exec()` on a pre-instantiated regex. In scripts that parse large log files line-by-line (like `daily_summary.ts` and `event_logger.ts`), this hot path can be optimized.
**Action:** When extracting fields via regex inside a loop on a hot path, hoist the regex literal out of the loop into a module-level constant (e.g., `const TS_REGEX = /.../`) and use `TS_REGEX.exec(line)` instead of `line.match(...)`. Ensure the regex does not have the global (`/g`) flag so that `lastIndex` is not preserved between calls.
