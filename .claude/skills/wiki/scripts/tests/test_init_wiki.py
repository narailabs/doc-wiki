"""Tests for init_wiki.py — wiki scaffold creation."""
import json
import subprocess
import sys
from pathlib import Path

import pytest
import yaml

# Resolve the path to the scripts directory so we can import init_wiki
SCRIPTS_DIR = str(Path(__file__).resolve().parent.parent)
sys.path.insert(0, SCRIPTS_DIR)

import init_wiki  # noqa: E402


def _run_init(path: Path, *, domain: str = "general", name: str = "My Wiki"):
    """Helper: invoke init_wiki.main() with the given arguments."""
    argv = ["init_wiki.py", "--path", str(path), "--domain", domain, "--name", name]
    return init_wiki.main(argv)


# -- directory scaffold ---------------------------------------------------

EXPECTED_DIRS = [
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


def test_creates_directory_scaffold(tmp_wiki):
    """All required directories are created."""
    _run_init(tmp_wiki)
    for d in EXPECTED_DIRS:
        assert (tmp_wiki / d).is_dir(), f"Missing directory: {d}"


# -- wiki.config.yaml -----------------------------------------------------

def test_creates_wiki_config_yaml(tmp_wiki):
    """wiki.config.yaml is created with correct domain and name."""
    _run_init(tmp_wiki)
    cfg_path = tmp_wiki / "wiki.config.yaml"
    assert cfg_path.exists(), "wiki.config.yaml not created"

    cfg = yaml.safe_load(cfg_path.read_text())
    assert cfg["wiki"]["domain"] == "general"
    assert cfg["wiki"]["name"] == "My Wiki"
    assert cfg["wiki"]["max_depth"] == 3
    assert "ignore_file" in cfg["wiki"]


# -- initial wiki files ----------------------------------------------------

def test_creates_initial_wiki_files(tmp_wiki):
    """wiki/index.md, wiki/summaries.md, wiki/overview.md exist with headers."""
    _run_init(tmp_wiki)

    index = tmp_wiki / "wiki" / "index.md"
    summaries = tmp_wiki / "wiki" / "summaries.md"
    overview = tmp_wiki / "wiki" / "overview.md"

    assert index.exists(), "wiki/index.md not created"
    assert summaries.exists(), "wiki/summaries.md not created"
    assert overview.exists(), "wiki/overview.md not created"

    assert index.read_text().startswith("#"), "index.md missing header"
    assert summaries.read_text().startswith("#"), "summaries.md missing header"
    assert overview.read_text().startswith("#"), "overview.md missing header"


# -- .wiki-ignore ----------------------------------------------------------

def test_creates_wiki_ignore(tmp_wiki):
    """.wiki-ignore exists with default patterns."""
    _run_init(tmp_wiki)
    ignore_path = tmp_wiki / ".wiki-ignore"
    assert ignore_path.exists(), ".wiki-ignore not created"

    content = ignore_path.read_text()
    assert "__pycache__/" in content
    assert ".git/" in content
    assert "node_modules/" in content


# -- empty events log ------------------------------------------------------

def test_creates_empty_events_log(tmp_wiki):
    """log/events.jsonl exists and is empty."""
    _run_init(tmp_wiki)
    events = tmp_wiki / "log" / "events.jsonl"
    assert events.exists(), "log/events.jsonl not created"
    assert events.read_text() == "", "events.jsonl should be empty"


# -- empty edges file ------------------------------------------------------

def test_creates_empty_edges_file(tmp_wiki):
    """graph/edges.jsonl exists and is empty."""
    _run_init(tmp_wiki)
    edges = tmp_wiki / "graph" / "edges.jsonl"
    assert edges.exists(), "graph/edges.jsonl not created"
    assert edges.read_text() == "", "edges.jsonl should be empty"


# -- idempotency -----------------------------------------------------------

def test_idempotent_reinit(tmp_wiki):
    """Running init twice does not destroy existing content."""
    _run_init(tmp_wiki)

    # Write custom content into an existing file
    marker = "DO NOT DESTROY THIS LINE"
    (tmp_wiki / "wiki" / "index.md").write_text(f"# Custom\n{marker}\n")
    (tmp_wiki / "wiki.config.yaml").write_text(
        yaml.dump({"wiki": {"name": "Custom Wiki", "domain": "custom"}})
    )

    # Re-init
    _run_init(tmp_wiki)

    # Existing content must survive
    assert marker in (tmp_wiki / "wiki" / "index.md").read_text()

    cfg = yaml.safe_load((tmp_wiki / "wiki.config.yaml").read_text())
    assert cfg["wiki"]["name"] == "Custom Wiki", "Config was overwritten on re-init"


# -- custom domain and name ------------------------------------------------

def test_custom_domain_and_name(tmp_wiki):
    """domain and name passed via args appear in config."""
    _run_init(tmp_wiki, domain="biology", name="Bio Notes")
    cfg = yaml.safe_load((tmp_wiki / "wiki.config.yaml").read_text())
    assert cfg["wiki"]["domain"] == "biology"
    assert cfg["wiki"]["name"] == "Bio Notes"


# -- missing --path raises -------------------------------------------------

def test_missing_path_raises():
    """No --path arg raises SystemExit."""
    with pytest.raises(SystemExit):
        init_wiki.main(["init_wiki.py"])
