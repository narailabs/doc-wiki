## 2026-06-12 - Fix Bypass of Unbounded Select with Comments
**Vulnerability:** The DB policy's bounding check (`Policy._isUnboundedSelect`) was bypassing unbounded query checks if the SQL query contained comments with bounding keywords like `WHERE` (e.g. `SELECT * FROM users /* WHERE */`).
**Learning:** Checking for SQL security keywords against raw strings before stripping comments can lead to attackers or users accidentally bypassing safety mechanisms.
**Prevention:** Always strip comments or normalize queries before applying heuristic checks or regexes on SQL commands.
