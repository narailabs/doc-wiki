## 2024-05-18 - JSONL Log Parsing
**Learning:** Strict `String.includes()` checks on large append-only JSON logs can break on historical spaced-JSON formatting. Repeated regex instantiation inside reading loops can cause significant performance overhead.
**Action:** Use hoisted, format-tolerant regular expressions for fast pre-filtering without unconditional `JSON.parse()` parsing.
