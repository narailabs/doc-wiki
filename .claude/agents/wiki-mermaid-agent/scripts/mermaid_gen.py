#!/usr/bin/env python3
"""Convert agent output JSON with mermaid fields into fenced Mermaid code blocks.

Takes agent output JSON containing a ``mermaid`` field and generates properly
fenced mermaid code blocks for wiki pages.

Usage as a library:
    from mermaid_gen import format_mermaid_block, inject_mermaid
    block = format_mermaid_block({"type": "erDiagram", "title": "...", "code": "..."})
    page = inject_mermaid(page_content, [block])

Usage as a script:
    python mermaid_gen.py --input agent_output.json
    python mermaid_gen.py --input agent_output.json --page wiki/db/schema.md
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

# ── Constants ───────────────────────────────────────────────────────

SUPPORTED_TYPES = {
    "erDiagram", "sequenceDiagram", "graph", "flowchart",
    "classDiagram", "stateDiagram", "gantt", "pie", "gitgraph",
}

# Match types that include a direction suffix (e.g. "graph TD", "graph LR")
_TYPE_WITH_DIRECTION = re.compile(r"^(graph|flowchart)\s+(TD|TB|BT|RL|LR)$")

# ── Library API ─────────────────────────────────────────────────────


def format_mermaid_block(mermaid_data: dict) -> str:
    """Format a mermaid data dict into a fenced code block.

    *mermaid_data* must have keys ``type``, ``code``, and optionally ``title``.

    Returns a string like::

        %% Title: User Orders
        ```mermaid
        erDiagram
            users ||--o{ orders : has
        ```
    """
    diagram_type = mermaid_data.get("type", "")
    title = mermaid_data.get("title", "")
    code = mermaid_data.get("code", "")

    lines: list[str] = []

    if title:
        lines.append(f"%% Title: {title}")

    lines.append("```mermaid")
    lines.append(diagram_type)
    lines.append(code)
    lines.append("```")

    return "\n".join(lines)


def inject_mermaid(
    page_content: str,
    mermaid_blocks: list[str],
    section: str = "## Diagrams",
) -> str:
    """Inject mermaid blocks into page content under a section heading.

    If the page already has a section matching *section*, that section is
    replaced (up to the next ``##`` heading or end of file).  Otherwise the
    section is appended at the end.
    """
    blocks_text = "\n\n".join(mermaid_blocks)
    new_section = f"{section}\n\n{blocks_text}\n"

    # Escape the section heading for regex
    escaped = re.escape(section)
    # Match from section heading to next ## heading or end of string
    pattern = re.compile(
        escaped + r"\n.*?(?=\n## |\Z)",
        re.DOTALL,
    )

    if pattern.search(page_content):
        result = pattern.sub(new_section, page_content)
    else:
        if page_content and not page_content.endswith("\n"):
            page_content += "\n"
        if page_content:
            result = page_content + "\n" + new_section
        else:
            result = new_section

    return result


def extract_mermaid_from_output(agent_output: dict) -> list[dict]:
    """Extract mermaid entries from agent JSON output.

    Looks for a ``mermaid`` key that contains a list of dicts, each with
    ``type``, ``title``, and ``code`` keys.

    Returns an empty list if no mermaid field is found.
    """
    mermaid = agent_output.get("mermaid")
    if not mermaid or not isinstance(mermaid, list):
        return []
    return list(mermaid)


def validate_mermaid_type(diagram_type: str) -> bool:
    """Check if a diagram type is supported.

    Handles types with direction suffixes (e.g. ``graph TD``).
    """
    if not diagram_type:
        return False
    if diagram_type in SUPPORTED_TYPES:
        return True
    if _TYPE_WITH_DIRECTION.match(diagram_type):
        return True
    return False


# ── CLI ─────────────────────────────────────────────────────────────


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Generate fenced Mermaid blocks from agent output JSON."
    )
    parser.add_argument(
        "--input", required=True,
        help="Path to agent output JSON file",
    )
    parser.add_argument(
        "--page", default=None,
        help="Path to wiki page file for injection (updates in-place)",
    )
    return parser


def main(argv: list[str] = None) -> None:
    parser = _build_parser()
    args = parser.parse_args(argv)

    input_path = Path(args.input)
    agent_output = json.loads(input_path.read_text())

    mermaid_entries = extract_mermaid_from_output(agent_output)

    if not mermaid_entries:
        print("No mermaid entries found in agent output.")
        return

    blocks = [format_mermaid_block(entry) for entry in mermaid_entries]

    if args.page:
        page_path = Path(args.page)
        if page_path.exists():
            content = page_path.read_text()
        else:
            content = ""
        result = inject_mermaid(content, blocks)
        page_path.write_text(result)
        print(f"Injected {len(blocks)} mermaid block(s) into {args.page}")
    else:
        print("\n\n".join(blocks))


if __name__ == "__main__":
    main()
