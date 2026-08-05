# Managed Section Content Check

Assertion: the refreshed managed section must contain at least one
markdown heading AND either a link into `wiki/` OR a mention of the
project's real name (`eval-i3-cmd-preserve`).

## Extracted managed content (verbatim between markers)

```
## Overview

Auto-generated documentation index for **eval-i3-cmd-preserve**.

- [Wiki documentation](wiki/index.md)

## Build & Run

See project-specific build instructions.

## Service Dependencies

See wiki for service dependency details.

## Database References

See wiki for database schema documentation.
```

## Findings

| Requirement                                      | Evidence                                               | Result |
|--------------------------------------------------|--------------------------------------------------------|--------|
| At least one `#`/`##` heading                    | `## Overview`, `## Build & Run`, `## Service Dependencies`, `## Database References` (4 headings) | PASS |
| Link into `wiki/` OR project-name mention        | `[Wiki documentation](wiki/index.md)` AND `**eval-i3-cmd-preserve**` | PASS (both) |
| Not whitespace-only                              | 366 bytes of structured markdown                       | PASS   |
| Not an error stub                                | No error text, four real sections                      | PASS   |

Both sub-conditions of the OR are satisfied, so the assertion passes
regardless of interpretation.
