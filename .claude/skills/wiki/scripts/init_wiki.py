#!/usr/bin/env python3
"""init_wiki.py -- Create the directory scaffold and default config for a documentation wiki.

Usage:
    python init_wiki.py --path /path/to/wiki-root [--domain general] [--name "My Wiki"]

The script is idempotent: existing directories are kept, existing config is
not overwritten, and existing wiki files are preserved.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Dict, List, Optional

import yaml


# -- constants ----------------------------------------------------------------

SCAFFOLD_DIRS = [
    "wiki",
    "raw",
    "graph",
    "audit/open",
    "audit/resolved",
    "log/daily",
    "outputs/queries",
    "outputs/reports",
    ".wiki-cache",
]

WIKI_IGNORE_DEFAULTS = [
    "__pycache__/",
    ".git/",
    "node_modules/",
    ".DS_Store",
    "*.pyc",
]

INITIAL_WIKI_FILES = {
    "wiki/index.md": "# Index\n\nWiki entry point.\n",
    "wiki/summaries.md": "# Summaries\n\nHigh-level summaries of wiki topics.\n",
    "wiki/overview.md": "# Overview\n\nOverview of the knowledge domain.\n",
}


# -- helpers ------------------------------------------------------------------

def _build_config(domain: str, name: str) -> dict:
    """Return the default wiki.config.yaml structure."""
    return {
        "wiki": {
            "name": name,
            "domain": domain,
            "max_depth": 3,
            "ignore_file": ".wiki-ignore",
        },
        "autonomy": {
            "mode": "balanced",
        },
        "sources": {
            "providers": {
                "file": {"type": "static"},
            },
        },
        "security": {
            "url_schemes": ["http", "https"],
            "block_file_redirects": True,
            "fetch_size_cap_mb": 50,
            "fetch_timeout_s": 60,
            "path_containment_check": True,
            "label_sanitization": {
                "strip_control_chars": True,
                "max_length": 256,
                "html_escape": True,
            },
        },
        "graph": {
            "enabled": True,
            "edges_file": "graph/edges.jsonl",
        },
        "cache": {
            "enabled": True,
            "dir": ".wiki-cache",
        },
        "logging": {
            "format": "jsonl",
            "events_file": "log/events.jsonl",
        },
    }


def _parse_args(argv: Optional[List[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Initialize a documentation wiki scaffold.",
    )
    parser.add_argument(
        "--path",
        required=True,
        help="Root directory for the wiki.",
    )
    parser.add_argument(
        "--domain",
        default="general",
        help="Knowledge domain (default: general).",
    )
    parser.add_argument(
        "--name",
        default="My Wiki",
        help='Display name for the wiki (default: "My Wiki").',
    )
    return parser.parse_args(argv[1:] if argv else None)


# -- main entry point --------------------------------------------------------

def main(argv: Optional[List[str]] = None) -> dict:
    """Create the wiki scaffold.  Returns a result dict."""
    args = _parse_args(argv)
    root = Path(args.path).resolve()

    created_dirs: List[str] = []
    created_files: List[str] = []

    # 1. Create directories
    for d in SCAFFOLD_DIRS:
        target = root / d
        if not target.exists():
            target.mkdir(parents=True, exist_ok=True)
            created_dirs.append(d)

    # 2. Write wiki.config.yaml (skip if exists)
    config_path = root / "wiki.config.yaml"
    if not config_path.exists():
        config = _build_config(domain=args.domain, name=args.name)
        config_path.write_text(yaml.dump(config, default_flow_style=False, sort_keys=False))
        created_files.append("wiki.config.yaml")

    # 3. Create initial wiki files (skip if exists)
    for rel_path, content in INITIAL_WIKI_FILES.items():
        target = root / rel_path
        if not target.exists():
            target.write_text(content)
            created_files.append(rel_path)

    # 4. Create .wiki-ignore (skip if exists)
    ignore_path = root / ".wiki-ignore"
    if not ignore_path.exists():
        ignore_path.write_text("\n".join(WIKI_IGNORE_DEFAULTS) + "\n")
        created_files.append(".wiki-ignore")

    # 5. Create empty events log (skip if exists)
    events_path = root / "log" / "events.jsonl"
    if not events_path.exists():
        events_path.touch()
        created_files.append("log/events.jsonl")

    # 6. Create empty edges file (skip if exists)
    edges_path = root / "graph" / "edges.jsonl"
    if not edges_path.exists():
        edges_path.touch()
        created_files.append("graph/edges.jsonl")

    result = {
        "status": "ok",
        "wiki_root": str(root),
        "created_dirs": created_dirs,
        "created_files": created_files,
    }
    print(json.dumps(result))
    return result


if __name__ == "__main__":
    main()
