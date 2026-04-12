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


@pytest.fixture
def sample_frontmatter():
    """Return a dict with all 8 required frontmatter fields."""
    return {
        "title": "Test Page",
        "type": "concept",
        "tags": ["authentication", "jwt", "session-management", "security"],
        "sources": ["raw/auth/overview.md"],
        "created": "2026-04-12",
        "updated": "2026-04-12",
        "quality": 0.0,
        "summary": "A test page about authentication concepts.",
    }


@pytest.fixture
def wiki_with_pages(initialized_wiki):
    """Initialized wiki with 5 pages of varying quality + populated edges.

    Pages:
      - wiki/auth/session.md — high quality (600+ words, full frontmatter, links, mermaid)
      - wiki/auth/jwt.md — missing title
      - wiki/db/schema.md — no sources cited
      - wiki/orphan.md — not linked from index or any page
      - wiki/broken.md — contains broken links
    """
    import yaml

    wiki_dir = initialized_wiki / "wiki"
    (wiki_dir / "auth").mkdir(parents=True, exist_ok=True)
    (wiki_dir / "db").mkdir(parents=True, exist_ok=True)

    # --- Page 1: high quality ---
    body_words = " ".join(["word"] * 150)
    (wiki_dir / "auth" / "session.md").write_text(
        "---\n"
        + yaml.dump({
            "title": "Session Management",
            "type": "concept",
            "tags": ["authentication", "jwt", "session-management", "security"],
            "sources": ["raw/auth/overview.md"],
            "created": "2026-04-12",
            "updated": "2026-04-12",
            "quality": 0.0,
            "summary": "How session management works in the auth system.",
        })
        + "---\n\n"
        + f"# Session Management\n\n{body_words}\n\n"
        + "See also [JWT tokens](jwt.md) and [DB schema](../db/schema.md) "
        + "and [overview](../index.md).\n\n"
        + "```mermaid\nsequenceDiagram\n    Client->>Server: Login\n    Server-->>Client: Token\n```\n"
    )

    # --- Page 2: missing title ---
    (wiki_dir / "auth" / "jwt.md").write_text(
        "---\n"
        + yaml.dump({
            "type": "concept",
            "tags": ["jwt"],
            "sources": ["raw/auth/jwt-spec.md"],
            "created": "2026-04-12",
            "updated": "2026-04-12",
            "quality": 0.0,
            "summary": "JWT token format and validation.",
        })
        + "---\n\nJWT tokens are used for stateless auth. " + " ".join(["content"] * 60) + "\n"
    )

    # --- Page 3: no sources ---
    (wiki_dir / "db" / "schema.md").write_text(
        "---\n"
        + yaml.dump({
            "title": "Database Schema",
            "type": "entity",
            "tags": ["database", "schema"],
            "sources": [],
            "created": "2026-04-12",
            "updated": "2026-04-12",
            "quality": 0.0,
            "summary": "Core database schema for the application.",
        })
        + "---\n\nThe database schema includes users and orders tables. "
        + " ".join(["detail"] * 80) + "\n"
    )

    # --- Page 4: orphan (not linked from anywhere) ---
    (wiki_dir / "orphan.md").write_text(
        "---\n"
        + yaml.dump({
            "title": "Orphan Page",
            "type": "concept",
            "tags": ["orphan-test"],
            "sources": ["raw/misc/orphan.md"],
            "created": "2026-04-12",
            "updated": "2026-04-12",
            "quality": 0.0,
            "summary": "This page is not linked from anywhere.",
        })
        + "---\n\nThis is an orphan page with no incoming links. "
        + " ".join(["filler"] * 40) + "\n"
    )

    # --- Page 5: broken links ---
    (wiki_dir / "broken.md").write_text(
        "---\n"
        + yaml.dump({
            "title": "Page With Broken Links",
            "type": "concept",
            "tags": ["testing"],
            "sources": ["raw/test/broken.md"],
            "created": "2026-04-12",
            "updated": "2026-04-12",
            "quality": 0.0,
            "summary": "A page containing broken links for testing.",
        })
        + "---\n\nSee [missing page](wiki/nonexistent.md) and "
        + "[also missing](wiki/gone.md).\n"
    )

    # Update index to link to some pages
    (wiki_dir / "index.md").write_text(
        "# Test Wiki Index\n\n"
        "- [Session Management](auth/session.md)\n"
        "- [JWT](auth/jwt.md)\n"
        "- [DB Schema](db/schema.md)\n"
        "- [Broken Links](broken.md)\n"
    )

    # Populate edges.jsonl — session.md is a god-node, orphan.md is isolated
    edges = [
        {"from": "wiki/auth/session.md", "to": "wiki/auth/jwt.md",
         "type": "extends", "provenance": "EXTRACTED", "evidence": "", "source_file": "", "date": "2026-04-12"},
        {"from": "wiki/auth/session.md", "to": "wiki/db/schema.md",
         "type": "supports", "provenance": "EXTRACTED", "evidence": "", "source_file": "", "date": "2026-04-12"},
        {"from": "wiki/auth/session.md", "to": "wiki/broken.md",
         "type": "extends", "provenance": "INFERRED", "evidence": "", "source_file": "", "date": "2026-04-12"},
        {"from": "wiki/auth/jwt.md", "to": "wiki/db/schema.md",
         "type": "supports", "provenance": "EXTRACTED", "evidence": "", "source_file": "", "date": "2026-04-12"},
        {"from": "wiki/db/schema.md", "to": "wiki/broken.md",
         "type": "extends", "provenance": "AMBIGUOUS", "evidence": "", "source_file": "", "date": "2026-04-12"},
    ]
    edges_path = initialized_wiki / "graph" / "edges.jsonl"
    with open(edges_path, "w") as f:
        for e in edges:
            f.write(json.dumps(e) + "\n")

    return initialized_wiki


@pytest.fixture
def wiki_with_events(initialized_wiki):
    """Initialized wiki with pre-populated events across 2 dates."""
    events = [
        # 2026-04-11 events
        {"ts": "2026-04-11T10:00:00+00:00", "op": "ingest", "source": "report.pdf",
         "agent": "file", "cost_usd": 0.05, "tokens_in": 5000, "tokens_out": 1200},
        {"ts": "2026-04-11T11:00:00+00:00", "op": "ingest", "source": "slides.pptx",
         "agent": "file", "cost_usd": 0.03, "tokens_in": 3000, "tokens_out": 800},
        {"ts": "2026-04-11T14:00:00+00:00", "op": "query", "source": "how does auth work?",
         "agent": "wiki", "cost_usd": 0.02, "tokens_in": 2000, "tokens_out": 500,
         "reduction_ratio": 42.0},
        # 2026-04-12 events
        {"ts": "2026-04-12T09:00:00+00:00", "op": "ingest", "source": "api-docs.md",
         "agent": "file", "cost_usd": 0.04, "tokens_in": 4000, "tokens_out": 1000},
        {"ts": "2026-04-12T10:30:00+00:00", "op": "query", "source": "what is JWT?",
         "agent": "wiki", "cost_usd": 0.01, "tokens_in": 1500, "tokens_out": 400,
         "reduction_ratio": 35.0},
        {"ts": "2026-04-12T11:00:00+00:00", "op": "query", "source": "database schema overview",
         "agent": "wiki", "cost_usd": 0.02, "tokens_in": 2200, "tokens_out": 600,
         "reduction_ratio": 28.0},
        {"ts": "2026-04-12T12:00:00+00:00", "op": "lint",
         "cost_usd": 0.01, "tokens_in": 1000, "tokens_out": 300},
        {"ts": "2026-04-12T13:00:00+00:00", "op": "ingest", "source": "design.docx",
         "agent": "jira", "cost_usd": 0.06, "tokens_in": 6000, "tokens_out": 1500},
    ]
    events_path = initialized_wiki / "log" / "events.jsonl"
    with open(events_path, "w") as f:
        for e in events:
            f.write(json.dumps(e) + "\n")

    return initialized_wiki
