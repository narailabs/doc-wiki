#!/usr/bin/env python3
"""Security checks for the documentation wiki.

Provides URL validation, path containment checks, and label sanitization.
Importable as a module or runnable as a CLI script.

CLI usage:
    python3 security_check.py --url <url>
    python3 security_check.py --path <path> --wiki-root <root>
    python3 security_check.py --label <text>

Exit codes: 0 = pass, 1 = fail (with JSON error on stdout).
"""
import argparse
import html
import json
import os
import sys
import unicodedata
from pathlib import Path
from urllib.parse import urlparse


ALLOWED_SCHEMES = {"http", "https"}


def validate_url(url: str) -> bool:
    """Check that a URL uses an allowed scheme (http or https only).

    Args:
        url: The URL string to validate.

    Returns:
        True if the URL is valid and uses http/https, False otherwise.
    """
    if not url:
        return False
    try:
        parsed = urlparse(url)
        return parsed.scheme in ALLOWED_SCHEMES
    except Exception:
        return False


def check_path_containment(path: str, wiki_root: str) -> bool:
    """Verify that a path resolves to a location inside wiki_root.

    Resolves symlinks before checking to prevent symlink traversal attacks.

    Args:
        path: The file path to check.
        wiki_root: The wiki root directory that must contain the path.

    Returns:
        True if the resolved path is inside the resolved wiki_root.
    """
    try:
        resolved_path = Path(path).resolve()
        resolved_root = Path(wiki_root).resolve()
        # Use os.path.commonpath to check containment after resolution
        return str(resolved_path).startswith(str(resolved_root) + os.sep) or resolved_path == resolved_root
    except (ValueError, OSError):
        return False


def sanitize_label(label: str, max_length: int = 256) -> str:
    """Sanitize a label by stripping control characters, capping length, and HTML-escaping.

    Args:
        label: The raw label text.
        max_length: Maximum allowed length (default 256).

    Returns:
        The sanitized label string.
    """
    # Strip control characters (Unicode category Cc)
    cleaned = "".join(
        ch for ch in label
        if unicodedata.category(ch) != "Cc"
    )
    # Truncate to max_length
    cleaned = cleaned[:max_length]
    # HTML-escape to prevent XSS
    cleaned = html.escape(cleaned)
    return cleaned


def main():
    parser = argparse.ArgumentParser(description="Wiki security checks")
    parser.add_argument("--url", help="Validate a URL (http/https only)")
    parser.add_argument("--path", help="Check path containment")
    parser.add_argument("--wiki-root", help="Wiki root for path containment check")
    parser.add_argument("--label", help="Sanitize a label")
    args = parser.parse_args()

    if args.url is not None:
        if validate_url(args.url):
            print(json.dumps({"ok": True, "url": args.url}))
            sys.exit(0)
        else:
            print(json.dumps({"error": f"URL rejected: {args.url}"}))
            sys.exit(1)

    elif args.path is not None:
        if not args.wiki_root:
            print(json.dumps({"error": "--wiki-root is required with --path"}))
            sys.exit(1)
        if check_path_containment(args.path, args.wiki_root):
            print(json.dumps({"ok": True, "path": args.path}))
            sys.exit(0)
        else:
            print(json.dumps({"error": f"Path escapes wiki root: {args.path}"}))
            sys.exit(1)

    elif args.label is not None:
        result = sanitize_label(args.label)
        print(json.dumps({"ok": True, "sanitized": result}))
        sys.exit(0)

    else:
        parser.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()
