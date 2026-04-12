#!/usr/bin/env python3
"""Generate and regenerate CLAUDE.md files with marked-section preservation.

Content between ``<!-- wiki-managed: start -->`` and ``<!-- wiki-managed: end -->``
is regenerated on re-invocation.  All content outside markers is preserved
(user sections).

Usage as a library:
    from claude_md_gen import generate_claude_md, update_claude_md
    md = generate_claude_md("/path/to/project", "/path/to/wiki")
    result = update_claude_md("CLAUDE.md", new_managed_content)

Usage as a script:
    python claude_md_gen.py --project-root /path --wiki-root /path/wiki
    python claude_md_gen.py --project-root /path --wiki-root /path/wiki --update CLAUDE.md
"""
from __future__ import annotations

import argparse
import os
import re
import sys
from pathlib import Path

# ── Constants ───────────────────────────────────────────────────────

MARKER_START = "<!-- wiki-managed: start -->"
MARKER_END = "<!-- wiki-managed: end -->"

_MANAGED_RE = re.compile(
    re.escape(MARKER_START) + r"\n(.*?)" + re.escape(MARKER_END),
    re.DOTALL,
)

# ── Library API ─────────────────────────────────────────────────────


def generate_claude_md(
    project_root: str,
    wiki_root: str,
    submodule: str = None,
) -> str:
    """Generate CLAUDE.md content with wiki-managed markers.

    *project_root* is the top-level project directory.
    *wiki_root* is the path to the wiki directory.
    *submodule* (optional) is a relative path to a submodule; when set the
    generated content includes a link back to the root CLAUDE.md.

    Returns the full managed section (between markers) as a markdown string.
    """
    project = Path(project_root)
    wiki = Path(wiki_root)

    lines: list[str] = []

    # Overview
    lines.append("## Overview")
    lines.append("")
    project_name = project.name or "Project"
    lines.append(f"Auto-generated documentation index for **{project_name}**.")
    lines.append("")

    # Wiki link
    try:
        wiki_rel = os.path.relpath(wiki, project)
    except ValueError:
        wiki_rel = str(wiki)
    lines.append(f"- [Wiki documentation]({wiki_rel}/index.md)")
    lines.append("")

    if submodule:
        # Link back to root CLAUDE.md
        sub_depth = len(Path(submodule).parts)
        root_rel = "/".join([".."] * sub_depth)
        lines.append("## Parent Project")
        lines.append("")
        lines.append(f"- [Root CLAUDE.md]({root_rel}/CLAUDE.md)")
        lines.append("")

    # Submodules listing (only for root, not submodule pages)
    if not submodule:
        submodules = list_submodules(project_root)
        if submodules:
            lines.append("## Submodules")
            lines.append("")
            for sub in sorted(submodules):
                lines.append(f"- [{sub}]({sub}/CLAUDE.md)")
            lines.append("")

    # Build & Run
    lines.append("## Build & Run")
    lines.append("")
    lines.append("See project-specific build instructions.")
    lines.append("")

    # Service Dependencies
    lines.append("## Service Dependencies")
    lines.append("")
    lines.append("See wiki for service dependency details.")
    lines.append("")

    # Database references
    lines.append("## Database References")
    lines.append("")
    lines.append("See wiki for database schema documentation.")
    lines.append("")

    inner_content = "\n".join(lines)
    return f"{MARKER_START}\n{inner_content}{MARKER_END}\n"


def update_claude_md(file_path: str, new_managed_content: str) -> str:
    """Replace content between markers, preserving the rest.

    If the file does not exist or has no markers, wraps *new_managed_content*
    with markers and returns the result.

    Returns the full file content as a string.
    """
    path = Path(file_path)

    if path.exists():
        content = path.read_text()
    else:
        content = ""

    replacement = f"{MARKER_START}\n{new_managed_content}{MARKER_END}"

    if MARKER_START in content and MARKER_END in content:
        result = _MANAGED_RE.sub(replacement, content)
    elif content:
        # Append markers at the end
        if not content.endswith("\n"):
            content += "\n"
        result = content + "\n" + replacement + "\n"
    else:
        result = replacement + "\n"

    return result


def extract_managed_section(content: str) -> str | None:
    """Return content between wiki-managed markers, or None if absent."""
    match = _MANAGED_RE.search(content)
    if match:
        return match.group(1)
    return None


def list_submodules(project_root: str) -> list[str]:
    """List directories that have their own CLAUDE.md files.

    Returns relative paths from *project_root*.  The root CLAUDE.md itself
    is excluded.
    """
    root = Path(project_root)
    submodules: list[str] = []

    for claude_md in root.rglob("CLAUDE.md"):
        # Skip the root CLAUDE.md
        if claude_md.parent == root:
            continue
        rel = str(claude_md.parent.relative_to(root))
        submodules.append(rel)

    return sorted(submodules)


# ── CLI ─────────────────────────────────────────────────────────────


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Generate or update CLAUDE.md with wiki-managed sections."
    )
    parser.add_argument(
        "--project-root", required=True,
        help="Root directory of the project",
    )
    parser.add_argument(
        "--wiki-root", required=True,
        help="Path to the wiki directory",
    )
    parser.add_argument(
        "--submodule", default=None,
        help="Submodule relative path (for submodule-specific CLAUDE.md)",
    )
    parser.add_argument(
        "--update", default=None, metavar="FILE",
        help="Path to existing CLAUDE.md to update in-place",
    )
    return parser


def main(argv: list[str] = None) -> None:
    parser = _build_parser()
    args = parser.parse_args(argv)

    full_generated = generate_claude_md(args.project_root, args.wiki_root, args.submodule)
    inner = extract_managed_section(full_generated)
    if inner is None:
        inner = full_generated

    if args.update:
        result = update_claude_md(args.update, inner)
        Path(args.update).parent.mkdir(parents=True, exist_ok=True)
        Path(args.update).write_text(result)
        print(f"Updated: {args.update}")
    else:
        print(full_generated)


if __name__ == "__main__":
    main()
