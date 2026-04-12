"""Shared fixtures for wiki skill script tests."""
import json
import os
import tempfile
from pathlib import Path

import pytest


@pytest.fixture
def tmp_wiki(tmp_path):
    """Create a temporary wiki root directory for testing."""
    return tmp_path / "wiki-root"


@pytest.fixture
def initialized_wiki(tmp_wiki):
    """Create a fully initialized wiki directory structure."""
    dirs = [
        "wiki", "raw", "graph", "audit/open", "audit/resolved",
        "log/daily", "outputs/queries", "outputs/reports", ".wiki-cache"
    ]
    for d in dirs:
        (tmp_wiki / d).mkdir(parents=True, exist_ok=True)

    # Create wiki.config.yaml
    config = {
        "wiki": {"name": "Test Wiki", "domain": "testing", "max_depth": 3},
        "autonomy": {"mode": "balanced"},
    }
    import yaml
    (tmp_wiki / "wiki.config.yaml").write_text(yaml.dump(config))

    # Create initial wiki files
    (tmp_wiki / "wiki" / "index.md").write_text("# Test Wiki Index\n")
    (tmp_wiki / "wiki" / "summaries.md").write_text("# Summaries\n")
    (tmp_wiki / "wiki" / "overview.md").write_text("# Overview\n")
    (tmp_wiki / ".wiki-ignore").write_text("__pycache__/\n.git/\n")

    # Create empty events log
    (tmp_wiki / "log" / "events.jsonl").touch()
    # Create empty edges file
    (tmp_wiki / "graph" / "edges.jsonl").touch()

    return tmp_wiki


@pytest.fixture
def sample_config():
    """Return a minimal valid wiki config dict."""
    return {
        "wiki": {
            "name": "Test Wiki",
            "domain": "testing",
            "description": "A test wiki",
            "max_depth": 3,
            "ignore_file": ".wiki-ignore",
        },
        "autonomy": {
            "mode": "balanced",
            "overrides": {
                "broken_links": "auto_fix",
                "missing_frontmatter": "auto_fix",
            },
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
    }
