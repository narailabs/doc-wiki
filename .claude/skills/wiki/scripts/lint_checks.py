#!/usr/bin/env python3
"""Structural lint checks for the documentation wiki.

Checks for broken links, missing frontmatter, orphan pages, isolated
graph nodes, code-reference drift, and provenance completeness.

Usage as a library:
    from lint_checks import lint_wiki, check_broken_links
    result = lint_wiki("/path/to/wiki")
    # {"issues": [...], "summary": {"error": 2, "warning": 5, "info": 1}}

Usage as a script:
    python lint_checks.py --wiki-root /path/to/wiki
    python lint_checks.py --wiki-root /path --category broken_links
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parent))
from graph_ops import isolated_nodes as _graph_isolated_nodes, list_edges

# ── Constants ───────────────────────────────────────────────────────

REQUIRED_FIELDS = {"title", "type", "tags", "sources", "created", "updated", "quality", "summary"}

_LINK_RE = re.compile(r"\[.*?\]\(([^)]+)\)")

# ── Helpers ─────────────────────────────────────────────────────────


def _parse_frontmatter(content: str) -> dict:
    """Parse YAML frontmatter from content. Returns {} if none found."""
    if not content.startswith("---\n"):
        return {}
    end = content.find("\n---\n", 4)
    if end == -1:
        return {}
    try:
        fm = yaml.safe_load(content[4:end])
    except yaml.YAMLError:
        return {}
    return fm if isinstance(fm, dict) else {}


def _wiki_pages(wiki_root: str) -> list[Path]:
    """List all .md files under wiki/."""
    wiki_dir = Path(wiki_root) / "wiki"
    if not wiki_dir.exists():
        return []
    return sorted(wiki_dir.rglob("*.md"))


def _issue(severity: str, category: str, page: str, detail: str) -> dict:
    return {"severity": severity, "category": category, "page": page, "detail": detail}


# ── Check functions ─────────────────────────────────────────────────


def check_broken_links(wiki_root: str) -> list[dict]:
    """Find markdown links pointing to non-existent wiki pages."""
    issues = []
    wiki_dir = Path(wiki_root) / "wiki"

    for page in _wiki_pages(wiki_root):
        content = page.read_text()
        links = _LINK_RE.findall(content)
        for link in links:
            # Skip external URLs, anchors, and non-.md links
            if link.startswith("http") or link.startswith("#") or not link.endswith(".md"):
                continue
            # Resolve relative to the page's directory
            target = (page.parent / link).resolve()
            if not target.exists():
                issues.append(_issue(
                    "error", "broken_links", str(page),
                    f"Link to {link} not found",
                ))
    return issues


def check_frontmatter(wiki_root: str) -> list[dict]:
    """Check all wiki pages for missing required frontmatter fields."""
    issues = []
    for page in _wiki_pages(wiki_root):
        content = page.read_text()
        fm = _parse_frontmatter(content)
        if not fm:
            issues.append(_issue(
                "error", "missing_frontmatter", str(page),
                "No frontmatter found (missing --- delimiters)",
            ))
            continue
        missing = REQUIRED_FIELDS - set(fm.keys())
        for field in sorted(missing):
            issues.append(_issue(
                "error", "missing_frontmatter", str(page),
                f"Missing required frontmatter field: {field}",
            ))
    return issues


def check_orphans(wiki_root: str) -> list[dict]:
    """Find pages not linked from any other page."""
    issues = []
    wiki_dir = Path(wiki_root) / "wiki"
    all_pages = _wiki_pages(wiki_root)
    page_names = {p.name for p in all_pages}

    # Build set of all linked-to filenames
    linked = set()
    for page in all_pages:
        content = page.read_text()
        links = _LINK_RE.findall(content)
        for link in links:
            if link.startswith("http") or link.startswith("#"):
                continue
            # Get the filename from the link path
            linked.add(Path(link).name)

    # index.md, summaries.md, overview.md are never orphans
    never_orphan = {"index.md", "summaries.md", "overview.md"}

    for page in all_pages:
        if page.name in never_orphan:
            continue
        if page.name not in linked:
            issues.append(_issue(
                "warning", "orphan_page", str(page),
                "Page is not linked from any other page",
            ))
    return issues


def check_isolated_nodes(wiki_root: str) -> list[dict]:
    """Find pages with degree <= 1 in the knowledge graph."""
    issues = []
    edges_path = str(Path(wiki_root) / "graph" / "edges.jsonl")

    all_pages = _wiki_pages(wiki_root)
    # Use relative paths matching edge format
    page_rel_paths = [str(p.relative_to(wiki_root)) for p in all_pages]

    isolated = _graph_isolated_nodes(edges_path, page_rel_paths)
    for node in isolated:
        issues.append(_issue(
            "warning", "isolated_node", node,
            f"Node has degree <= 1 in the knowledge graph",
        ))
    return issues


def check_code_ref_drift(wiki_root: str) -> list[dict]:
    """Check code references for content_hash mismatches."""
    issues = []
    root = Path(wiki_root)

    for page in _wiki_pages(wiki_root):
        content = page.read_text()
        fm = _parse_frontmatter(content)
        refs = fm.get("references", [])
        if not isinstance(refs, list):
            continue

        for ref in refs:
            if not isinstance(ref, dict):
                continue
            ref_path = ref.get("path", "")
            stored_hash = ref.get("content_hash", "")
            if not ref_path or not stored_hash:
                continue

            target = root / ref_path
            if not target.exists():
                issues.append(_issue(
                    "warning", "code_ref_drift", str(page),
                    f"Referenced file {ref_path} not found",
                ))
                continue

            actual_hash = hashlib.sha256(target.read_bytes()).hexdigest()
            if actual_hash != stored_hash:
                issues.append(_issue(
                    "warning", "code_ref_drift", str(page),
                    f"content_hash mismatch for {ref_path}",
                ))
    return issues


def check_provenance_completeness(wiki_root: str) -> list[dict]:
    """Check that every edge in edges.jsonl has a provenance field."""
    issues = []
    edges_path = str(Path(wiki_root) / "graph" / "edges.jsonl")
    edges = list_edges(edges_path)

    for i, edge in enumerate(edges):
        if "provenance" not in edge:
            issues.append(_issue(
                "error", "missing_provenance",
                f"edge #{i + 1}: {edge.get('from', '?')} -> {edge.get('to', '?')}",
                "Edge is missing required 'provenance' field",
            ))
    return issues


def check_high_ambiguity_rate(wiki_root: str) -> list[dict]:
    """Warn if > 20% of edges have AMBIGUOUS provenance."""
    issues = []
    edges_path = str(Path(wiki_root) / "graph" / "edges.jsonl")
    edges = list_edges(edges_path)

    if not edges:
        return issues

    ambiguous_count = sum(1 for e in edges if e.get("provenance") == "AMBIGUOUS")
    rate = ambiguous_count / len(edges)

    if rate > 0.20:
        issues.append(_issue(
            "warning", "high_ambiguity_rate", "graph/edges.jsonl",
            f"Ambiguity rate is {rate:.0%} ({ambiguous_count}/{len(edges)} edges are AMBIGUOUS)",
        ))
    return issues


# ── Main lint function ──────────────────────────────────────────────

CHECK_FUNCTIONS = {
    "broken_links": check_broken_links,
    "frontmatter": check_frontmatter,
    "orphans": check_orphans,
    "isolated_nodes": check_isolated_nodes,
    "code_ref_drift": check_code_ref_drift,
    "provenance": check_provenance_completeness,
    "ambiguity_rate": check_high_ambiguity_rate,
}


def lint_wiki(wiki_root: str, category: str = None) -> dict:
    """Run all lint checks (or a single category) and return results.

    Returns ``{"issues": [...], "summary": {"error": N, "warning": N, "info": N}}``.
    """
    if category:
        check_fn = CHECK_FUNCTIONS.get(category)
        issues = check_fn(wiki_root) if check_fn else []
    else:
        issues = []
        for check_fn in CHECK_FUNCTIONS.values():
            issues.extend(check_fn(wiki_root))

    summary = {"error": 0, "warning": 0, "info": 0}
    for issue in issues:
        sev = issue.get("severity", "info")
        if sev in summary:
            summary[sev] += 1

    return {"issues": issues, "summary": summary}


# ── CLI ─────────────────────────────────────────────────────────────


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Wiki structural lint checks.")
    parser.add_argument("--wiki-root", required=True, help="Wiki root path")
    parser.add_argument("--category", default=None,
                        choices=list(CHECK_FUNCTIONS.keys()),
                        help="Run only a specific check category")
    return parser


def main(argv: list[str] = None) -> None:
    parser = _build_parser()
    args = parser.parse_args(argv)
    result = lint_wiki(args.wiki_root, category=args.category)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
