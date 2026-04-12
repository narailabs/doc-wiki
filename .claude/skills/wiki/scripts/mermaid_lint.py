#!/usr/bin/env python3
"""Mermaid diagram syntax validation for wiki pages.

Extracts fenced ``mermaid`` code blocks, validates structural syntax
(diagram type, balanced brackets), and reports errors as lint warnings.

Usage as a library:
    from mermaid_lint import extract_mermaid_blocks, validate_block, lint_page
    blocks = extract_mermaid_blocks(content)
    errors = validate_block(block_content)
    issues = lint_page("wiki/auth/session.md")

Usage as a script:
    python mermaid_lint.py --page wiki/auth/session.md
    python mermaid_lint.py --wiki-root /path/to/wiki
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

# ── Constants ───────────────────────────────────────────────────────

VALID_DIAGRAM_TYPES = {
    "erDiagram", "sequenceDiagram", "graph", "flowchart",
    "classDiagram", "stateDiagram", "gantt", "pie", "gitgraph",
}

_MERMAID_BLOCK_RE = re.compile(r"```mermaid\s*\n(.*?)```", re.DOTALL)

_BRACKET_PAIRS = {"[": "]", "{": "}", "(": ")"}

# Diagram types where { } are used in relationship syntax, not as block delimiters
_RELATIONSHIP_BRACKET_TYPES = {"erDiagram"}

# ── Library API ─────────────────────────────────────────────────────


def extract_mermaid_blocks(content: str) -> list[dict]:
    """Extract all fenced mermaid code blocks from markdown content.

    Returns a list of dicts, each with:
    - ``line``: 1-indexed line number of the opening fence
    - ``content``: the block content (between fences)
    - ``diagram_type``: first keyword (e.g. ``erDiagram``, ``graph``)
    """
    blocks = []
    for match in _MERMAID_BLOCK_RE.finditer(content):
        line_num = content[:match.start()].count("\n") + 1
        block_content = match.group(1).strip()
        # Diagram type is the first non-empty token
        first_line = block_content.split("\n")[0].strip() if block_content else ""
        diagram_type = first_line.split()[0] if first_line else ""
        blocks.append({
            "line": line_num,
            "content": block_content,
            "diagram_type": diagram_type,
        })
    return blocks


def validate_block(block: str) -> list[str]:
    """Validate a mermaid block's structural syntax.

    Returns a list of error messages.  Empty list means valid.
    """
    block = block.strip()
    errors = []

    if not block:
        errors.append("Empty mermaid block")
        return errors

    # Check diagram type
    first_line = block.split("\n")[0].strip()
    diagram_type = first_line.split()[0] if first_line else ""

    if diagram_type not in VALID_DIAGRAM_TYPES:
        errors.append(
            f"Unrecognized diagram type '{diagram_type}'. "
            f"Expected one of: {', '.join(sorted(VALID_DIAGRAM_TYPES))}"
        )

    # Check balanced brackets (skip for diagram types that use { } in syntax)
    if diagram_type not in _RELATIONSHIP_BRACKET_TYPES:
        stack = []
        for char in block:
            if char in _BRACKET_PAIRS:
                stack.append(char)
            elif char in _BRACKET_PAIRS.values():
                if not stack:
                    errors.append(f"Unmatched closing bracket '{char}'")
                    break
                opener = stack.pop()
                if _BRACKET_PAIRS[opener] != char:
                    errors.append(
                        f"Mismatched brackets: '{opener}' opened but '{char}' found"
                    )
                    break
        if stack:
            unclosed = "".join(stack)
            errors.append(f"Unclosed brackets: {unclosed}")

    return errors


def lint_page(page_path: str) -> list[dict]:
    """Lint all mermaid blocks in a single wiki page.

    Returns a list of issue dicts for blocks with errors:
    ``{"page": str, "line": int, "errors": [str]}``
    """
    content = Path(page_path).read_text()
    blocks = extract_mermaid_blocks(content)
    issues = []
    for block in blocks:
        errors = validate_block(block["content"])
        if errors:
            issues.append({
                "page": page_path,
                "line": block["line"],
                "errors": errors,
            })
    return issues


def lint_wiki_mermaid(wiki_root: str) -> list[dict]:
    """Lint all mermaid blocks in all wiki pages.

    Globs ``wiki/**/*.md`` under *wiki_root*.
    """
    wiki_dir = Path(wiki_root) / "wiki"
    if not wiki_dir.exists():
        return []
    issues = []
    for page in sorted(wiki_dir.rglob("*.md")):
        issues.extend(lint_page(str(page)))
    return issues


# ── CLI ─────────────────────────────────────────────────────────────


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Validate Mermaid diagram syntax in wiki pages."
    )
    parser.add_argument("--page", help="Lint a single page")
    parser.add_argument("--wiki-root", help="Lint all pages in wiki/")
    return parser


def main(argv: list[str] = None) -> None:
    parser = _build_parser()
    args = parser.parse_args(argv)

    if args.wiki_root:
        issues = lint_wiki_mermaid(args.wiki_root)
    elif args.page:
        issues = lint_page(args.page)
    else:
        parser.print_help()
        return

    print(json.dumps(issues, indent=2))


if __name__ == "__main__":
    main()
