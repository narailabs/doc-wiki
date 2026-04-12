# Code Locality — References vs Copies

Wiki pages about code must decide: reference the code or copy it?

## Rule

**Local code → reference.** If the code lives inside the wiki's git root AND is accessible via the agent's Read tool, cite it as `path:lines` with a `content_hash` in frontmatter.

**External code → copy with attribution.** If the code comes from outside the wiki's git root (URLs, PDFs, GitHub permalinks, other repos), copy the snippet with attribution frontmatter.

## Detection

Local = same git repo AND `Read`-able. Everything else = external.

## Local Code Reference

Short illustrative snippets (6 lines max) are OK inline, but never substitute for re-reading the actual file.

```yaml
references:
  - path: src/auth/session.py
    lines: [42, 58]
    symbol: authenticate
    content_hash: e3b0c44298fc1c149afbf4c8996fb924
```

## External Code Copy

```yaml
external_code:
  - source_url: https://github.com/org/repo/blob/abc123/src/foo.py#L42-L50
    source_author: "Jane Doe"
    retrieved_date: 2026-04-12
    license: MIT
    context: "From org/repo commit abc123"
```

## GitHub Permalinks

Copy the snippet as external AND store the permalink. Commit SHAs are immutable but repos can be deleted.

## Drift Detection

On `/wiki-lint` or `/wiki-refresh`, recompute `content_hash` for each local reference. Mismatches emit a **lint warning, not a hard failure**. The wiki narrative may still be valid — human/agent reviews and re-anchors.

## Why This Matters

The wiki holds architecture insights, decision history, and rationale — with references back to code. Agents have better tools (Read, Glob, Grep, LSP) for navigating live code. For external code the agent can't access at query time, copying is the only option. References keep wiki pages lightweight; copies keep them self-contained.
