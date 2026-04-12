#!/usr/bin/env python3
"""Quality scoring for wiki pages (0.0-1.0).

Computes a combined quality score from content-level signals (word count,
frontmatter completeness, links, tags) and structural signals (graph degree,
Mermaid diagrams).  Score is clamped to [0.0, 1.0].

Usage as a library:
    from quality_score import score_page, score_wiki
    result = score_page("wiki/auth/session.md", "graph/edges.jsonl")
    # {"quality": 0.85, "signals": [{"signal": "word_count", "delta": 0.8}, ...]}

Usage as a script:
    python quality_score.py --page wiki/auth/session.md --edges graph/edges.jsonl
    python quality_score.py --wiki-root /path/to/wiki
"""
from __future__ import annotations

import argparse
import json
import math
import re
import sys
from pathlib import Path

import yaml

# Import graph_ops for structural analysis
sys.path.insert(0, str(Path(__file__).resolve().parent))
from graph_ops import compute_degrees

# ── Constants ───────────────────────────────────────────────────────

REQUIRED_FIELDS = {"title", "type", "tags", "sources", "created", "updated", "quality", "summary"}

# Tags that suggest a page should have a Mermaid diagram
MERMAID_EXPECTED_TAGS = {"database", "schema", "architecture", "service", "infrastructure", "erd", "topology"}

_LINK_RE = re.compile(r"\[.*?\]\((?!http|#)(.*?\.md)\)")
_MERMAID_RE = re.compile(r"```mermaid\s*\n.*?```", re.DOTALL)

# ── Library API ─────────────────────────────────────────────────────


def _parse_frontmatter(content: str) -> tuple[dict, str]:
    """Split content into frontmatter dict and body text."""
    if not content.startswith("---\n"):
        return {}, content
    end = content.find("\n---\n", 4)
    if end == -1:
        return {}, content
    fm_str = content[4:end]
    body = content[end + 5:]
    try:
        fm = yaml.safe_load(fm_str)
    except yaml.YAMLError:
        return {}, content
    if not isinstance(fm, dict):
        return {}, content
    return fm, body


def score_page(page_path: str, edges_path: str = None) -> dict:
    """Compute quality score for a single wiki page.

    Returns ``{"quality": float, "signals": [{"signal": str, "delta": float}]}``.
    """
    content = Path(page_path).read_text()
    fm, body = _parse_frontmatter(content)
    signals: list[dict] = []

    # ── Word count base score ───────────────────────────────────
    word_count = len(body.split())
    if word_count < 50:
        base = 0.1
    elif word_count < 150:
        base = 0.3
    elif word_count < 500:
        base = 0.6
    else:
        base = 0.8
    signals.append({"signal": "word_count", "delta": base})

    # ── Frontmatter completeness ────────────────────────────────
    present_fields = set(fm.keys()) & REQUIRED_FIELDS
    if present_fields == REQUIRED_FIELDS:
        signals.append({"signal": "complete_frontmatter", "delta": 0.1})

    # ── Missing title penalty ───────────────────────────────────
    if "title" not in fm:
        signals.append({"signal": "missing_title", "delta": -0.3})

    # ── No sources penalty ──────────────────────────────────────
    sources = fm.get("sources")
    if not sources:  # None, [], or missing
        signals.append({"signal": "no_sources", "delta": -0.2})

    # ── No summary penalty ──────────────────────────────────────
    if "summary" not in fm:
        signals.append({"signal": "no_summary", "delta": -0.1})

    # ── Cross-reference links bonus ─────────────────────────────
    links = _LINK_RE.findall(body)
    if len(links) >= 3:
        signals.append({"signal": "crossref_links", "delta": 0.1})

    # ── Concept tags bonus ──────────────────────────────────────
    tags = fm.get("tags", [])
    if isinstance(tags, list) and len(tags) >= 4:
        signals.append({"signal": "concept_tags", "delta": 0.05})

    # ── Claim-specific signals ──────────────────────────────────
    page_type = fm.get("type", "")
    if page_type == "claim":
        evidence = fm.get("evidence")
        if evidence and isinstance(evidence, list) and len(evidence) > 0:
            signals.append({"signal": "claim_has_evidence", "delta": 0.1})

        status = fm.get("status", "")
        if status == "deprecated":
            failure_reason = fm.get("failure_reason", "")
            if not failure_reason:
                signals.append({"signal": "deprecated_no_reason", "delta": -0.2})

    # ── Structural signals (from edges.jsonl) ───────────────────
    if edges_path:
        degrees = compute_degrees(edges_path)
        # Normalize page path for matching
        page_name = str(page_path)
        # Try to find a matching key in degrees
        page_degree = 0
        for key in degrees:
            if page_name.endswith(key) or key.endswith(Path(page_name).name):
                page_degree = degrees[key]
                break

        if degrees:
            # God-node: top 10% by degree
            all_degrees = sorted(degrees.values(), reverse=True)
            threshold_idx = max(1, math.ceil(len(all_degrees) * 0.1))
            threshold = all_degrees[threshold_idx - 1] if all_degrees else 0
            if page_degree >= threshold and page_degree > 1:
                signals.append({"signal": "god_node", "delta": 0.1})

            # Isolated node: degree <= 1
            if page_degree <= 1:
                signals.append({"signal": "isolated_node", "delta": -0.2})

    # ── Mermaid diagram signals ─────────────────────────────────
    has_mermaid = bool(_MERMAID_RE.search(body))
    if has_mermaid:
        signals.append({"signal": "has_mermaid", "delta": 0.05})
    else:
        # Penalty only for pages that should have diagrams
        tags_lower = {t.lower() for t in (tags if isinstance(tags, list) else [])}
        if tags_lower & MERMAID_EXPECTED_TAGS:
            signals.append({"signal": "missing_mermaid", "delta": -0.1})

    # ── Compute final score ─────────────────────────────────────
    total = sum(s["delta"] for s in signals)
    quality = max(0.0, min(1.0, total))

    return {"quality": round(quality, 4), "signals": signals}


def score_wiki(wiki_root: str) -> list[dict]:
    """Score all pages under wiki/ directory.

    Returns list sorted by quality descending, each entry:
    ``{"page": relative_path, "quality": float, "signals": [...]}``.
    """
    wiki_dir = Path(wiki_root) / "wiki"
    edges_path = Path(wiki_root) / "graph" / "edges.jsonl"
    ep = str(edges_path) if edges_path.exists() else None

    results = []
    if not wiki_dir.exists():
        return results

    for page in sorted(wiki_dir.rglob("*.md")):
        page_str = str(page)
        result = score_page(page_str, ep)
        rel_path = str(page.relative_to(Path(wiki_root)))
        results.append({
            "page": rel_path,
            "quality": result["quality"],
            "signals": result["signals"],
        })

    results.sort(key=lambda r: r["quality"], reverse=True)
    return results


# ── CLI ─────────────────────────────────────────────────────────────


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Wiki page quality scorer.")
    parser.add_argument("--page", help="Score a single page")
    parser.add_argument("--edges", help="Path to edges.jsonl")
    parser.add_argument("--wiki-root", help="Score all pages in wiki/")
    return parser


def main(argv: list[str] = None) -> None:
    parser = _build_parser()
    args = parser.parse_args(argv)

    if args.wiki_root:
        results = score_wiki(args.wiki_root)
        print(json.dumps(results, indent=2))
    elif args.page:
        result = score_page(args.page, args.edges)
        print(json.dumps(result, indent=2))
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
