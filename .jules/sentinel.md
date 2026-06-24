## 2026-06-24 - [Command Injection via Double Quotes]
**Vulnerability:** Double quoting unescaped variables like `wikiRoot` in shell commands allows command injection because double quotes do not prevent bash expansion or command substitution.
**Learning:** `JSON.stringify` only escapes double quotes and wraps strings in double quotes. It is insecure for UNIX shell environments.
**Prevention:** Use a proper escaping method for UNIX shell, like wrapping in single quotes and replacing inner single quotes with `'\''`.
