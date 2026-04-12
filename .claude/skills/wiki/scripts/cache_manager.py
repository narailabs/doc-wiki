#!/usr/bin/env python3
"""SHA256 content-hash cache for the documentation wiki.

Stores cache entries in .wiki-cache/ as <sha256>.json files.
Supports body-only hashing for markdown (strips YAML frontmatter).
Auto-invalidates when cache version changes.

Usage as a library:
    from cache_manager import compute_hash, check_cache, store_cache
    h = compute_hash(content, body_only=True)
    cached = check_cache("/path/to/wiki", h)
    if cached is None:
        store_cache("/path/to/wiki", h, {"source": "file.md", "pages": 2})

Usage as a script:
    python cache_manager.py check --wiki-root /path --content "..."
    python cache_manager.py store --wiki-root /path --content "..." --metadata '{"key": "val"}'
    python cache_manager.py clear --wiki-root /path
    python cache_manager.py version --wiki-root /path [--set 2]
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

# ── Constants ───────────────────────────────────────────────────────

CACHE_DIR_NAME = ".wiki-cache"
VERSION_FILE = "VERSION"
CURRENT_CACHE_VERSION = "1"

_FRONTMATTER_RE = re.compile(r"^---\n.*?\n---\n", re.DOTALL)

# ── Library API ─────────────────────────────────────────────────────


def compute_hash(content: str, body_only: bool = False) -> str:
    """Compute SHA256 hex digest of content.

    If *body_only* is True, strips YAML frontmatter (delimited by ``---``)
    before hashing.  Content without frontmatter is hashed as-is.
    """
    if body_only:
        m = _FRONTMATTER_RE.match(content)
        if m:
            content = content[m.end():]
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


def _cache_dir(wiki_root: str) -> Path:
    return Path(wiki_root) / CACHE_DIR_NAME


def _version_path(wiki_root: str) -> Path:
    return _cache_dir(wiki_root) / VERSION_FILE


def get_cache_version(wiki_root: str) -> str:
    """Read the cache VERSION file.  Returns ``'0'`` if missing."""
    p = _version_path(wiki_root)
    if p.exists():
        return p.read_text().strip()
    return "0"


def set_cache_version(wiki_root: str, version: str) -> None:
    """Write the cache VERSION file."""
    d = _cache_dir(wiki_root)
    d.mkdir(parents=True, exist_ok=True)
    _version_path(wiki_root).write_text(version)


def check_cache(wiki_root: str, content_hash: str) -> dict | None:
    """Return cached metadata for *content_hash*, or None on miss.

    Returns None if:
    - the cache directory does not exist
    - no entry file exists for the hash
    - the entry file is malformed JSON
    - the entry's ``cache_version`` does not match the current version
    """
    cache_file = _cache_dir(wiki_root) / f"{content_hash}.json"
    if not cache_file.exists():
        return None
    try:
        data = json.loads(cache_file.read_text())
    except (json.JSONDecodeError, OSError):
        return None

    current_version = get_cache_version(wiki_root)
    if data.get("cache_version") != current_version:
        return None

    return data


def store_cache(wiki_root: str, content_hash: str, metadata: dict) -> None:
    """Write a cache entry to ``.wiki-cache/<hash>.json``.

    The current cache version is embedded in the entry so that
    :func:`check_cache` can auto-invalidate on version change.
    """
    d = _cache_dir(wiki_root)
    d.mkdir(parents=True, exist_ok=True)

    entry = {**metadata, "cache_version": get_cache_version(wiki_root)}
    cache_file = d / f"{content_hash}.json"
    cache_file.write_text(json.dumps(entry))


def clear_cache(wiki_root: str) -> int:
    """Remove all ``.json`` cache entries.  Preserves the VERSION file.

    Returns the number of entries removed.
    """
    d = _cache_dir(wiki_root)
    if not d.exists():
        return 0
    count = 0
    for f in d.glob("*.json"):
        f.unlink()
        count += 1
    return count


# ── CLI ─────────────────────────────────────────────────────────────


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="SHA256 content-hash cache manager.")
    sub = parser.add_subparsers(dest="command")

    check_p = sub.add_parser("check", help="Check if content is cached")
    check_p.add_argument("--wiki-root", required=True)
    check_p.add_argument("--content", required=True)
    check_p.add_argument("--body-only", action="store_true")

    store_p = sub.add_parser("store", help="Store a cache entry")
    store_p.add_argument("--wiki-root", required=True)
    store_p.add_argument("--content", required=True)
    store_p.add_argument("--metadata", default="{}", help="JSON metadata string")
    store_p.add_argument("--body-only", action="store_true")

    clear_p = sub.add_parser("clear", help="Clear all cache entries")
    clear_p.add_argument("--wiki-root", required=True)

    ver_p = sub.add_parser("version", help="Get or set cache version")
    ver_p.add_argument("--wiki-root", required=True)
    ver_p.add_argument("--set", dest="set_version", default=None)

    return parser


def main(argv: list[str] = None) -> None:
    parser = _build_parser()
    args = parser.parse_args(argv)

    if args.command == "check":
        h = compute_hash(args.content, body_only=args.body_only)
        result = check_cache(args.wiki_root, h)
        if result is not None:
            print(json.dumps({"hit": True, "hash": h, "metadata": result}))
        else:
            print(json.dumps({"hit": False, "hash": h}))

    elif args.command == "store":
        h = compute_hash(args.content, body_only=args.body_only)
        meta = json.loads(args.metadata)
        store_cache(args.wiki_root, h, meta)
        print(json.dumps({"stored": True, "hash": h}))

    elif args.command == "clear":
        count = clear_cache(args.wiki_root)
        print(json.dumps({"removed": count}))

    elif args.command == "version":
        if args.set_version is not None:
            set_cache_version(args.wiki_root, args.set_version)
            print(json.dumps({"version": args.set_version}))
        else:
            print(json.dumps({"version": get_cache_version(args.wiki_root)}))

    else:
        parser.print_help()


if __name__ == "__main__":
    main()
