"""Tests for lint_checks.py — written BEFORE implementation (TDD)."""
import hashlib
import json
import subprocess
import sys
from pathlib import Path

import pytest
import yaml

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from lint_checks import (
    lint_wiki,
    check_broken_links,
    check_frontmatter,
    check_orphans,
    check_isolated_nodes,
    check_code_ref_drift,
    check_provenance_completeness,
    check_high_ambiguity_rate,
)

# ── Helpers ─────────────────────────────────────────────────────────


def _write_page(path, frontmatter, body):
    """Write a wiki page with YAML frontmatter + body text."""
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    content = "---\n" + yaml.dump(frontmatter) + "---\n\n" + body
    Path(path).write_text(content)


def _full_fm(**overrides):
    fm = {
        "title": "Test Page",
        "type": "concept",
        "tags": ["test"],
        "sources": ["raw/test.md"],
        "created": "2026-04-12",
        "updated": "2026-04-12",
        "quality": 0.0,
        "summary": "Test page summary.",
    }
    fm.update(overrides)
    return fm


# ── Broken links tests ─────────────────────────────────────────────


class TestCheckBrokenLinks:
    def test_detects_broken_link(self, initialized_wiki):
        """Page with link to non-existent file returns an error."""
        wiki = str(initialized_wiki)
        page = str(initialized_wiki / "wiki" / "page.md")
        _write_page(page, _full_fm(), "See [missing](nonexistent.md).\n")
        issues = check_broken_links(wiki)
        broken = [i for i in issues if "nonexistent" in i["detail"]]
        assert len(broken) >= 1
        assert broken[0]["severity"] == "error"

    def test_valid_links_no_issues(self, initialized_wiki):
        """Page with links to existing pages returns empty list."""
        wiki = str(initialized_wiki)
        page = str(initialized_wiki / "wiki" / "page.md")
        _write_page(page, _full_fm(), "See [index](index.md).\n")
        issues = check_broken_links(wiki)
        # Filter to only issues from our test page
        page_issues = [i for i in issues if "page.md" in i["page"]]
        assert page_issues == []

    def test_external_links_ignored(self, initialized_wiki):
        """Links starting with http are not checked."""
        wiki = str(initialized_wiki)
        page = str(initialized_wiki / "wiki" / "page.md")
        _write_page(page, _full_fm(), "See [google](https://google.com).\n")
        issues = check_broken_links(wiki)
        page_issues = [i for i in issues if "page.md" in i["page"]]
        assert page_issues == []

    def test_anchor_links_ignored(self, initialized_wiki):
        """Links like [section](#heading) are not checked."""
        wiki = str(initialized_wiki)
        page = str(initialized_wiki / "wiki" / "page.md")
        _write_page(page, _full_fm(), "See [section](#overview).\n")
        issues = check_broken_links(wiki)
        page_issues = [i for i in issues if "page.md" in i["page"]]
        assert page_issues == []


# ── Frontmatter tests ──────────────────────────────────────────────


class TestCheckFrontmatter:
    def test_detects_missing_title(self, initialized_wiki):
        """Page without title returns an error."""
        wiki = str(initialized_wiki)
        fm = _full_fm()
        del fm["title"]
        page = str(initialized_wiki / "wiki" / "notitle.md")
        _write_page(page, fm, "Content.\n")
        issues = check_frontmatter(wiki)
        title_issues = [i for i in issues if "title" in i["detail"].lower()
                        and "notitle.md" in i["page"]]
        assert len(title_issues) >= 1

    def test_detects_missing_multiple_fields(self, initialized_wiki):
        """Page missing multiple fields returns issues for each."""
        wiki = str(initialized_wiki)
        page = str(initialized_wiki / "wiki" / "sparse.md")
        _write_page(page, {"type": "concept"}, "Content.\n")
        issues = check_frontmatter(wiki)
        sparse_issues = [i for i in issues if "sparse.md" in i["page"]]
        assert len(sparse_issues) >= 3  # missing title, sources, summary, etc.

    def test_complete_frontmatter_no_issues(self, initialized_wiki):
        """Page with all required fields returns no issues."""
        wiki = str(initialized_wiki)
        page = str(initialized_wiki / "wiki" / "complete.md")
        _write_page(page, _full_fm(), "Content.\n")
        issues = check_frontmatter(wiki)
        complete_issues = [i for i in issues if "complete.md" in i["page"]]
        assert complete_issues == []

    def test_no_frontmatter_at_all(self, initialized_wiki):
        """Page with no --- delimiters returns errors."""
        wiki = str(initialized_wiki)
        page = str(initialized_wiki / "wiki" / "nofm.md")
        Path(page).parent.mkdir(parents=True, exist_ok=True)
        Path(page).write_text("# Just a heading\n\nNo frontmatter.\n")
        issues = check_frontmatter(wiki)
        nofm_issues = [i for i in issues if "nofm.md" in i["page"]]
        assert len(nofm_issues) >= 1


# ── Orphans tests ──────────────────────────────────────────────────


class TestCheckOrphans:
    def test_detects_orphan_page(self, wiki_with_pages):
        """Page not linked from any other page is flagged."""
        issues = check_orphans(str(wiki_with_pages))
        orphan_pages = [i["page"] for i in issues]
        assert any("orphan.md" in p for p in orphan_pages)

    def test_linked_page_not_orphan(self, wiki_with_pages):
        """Page linked from index is not flagged."""
        issues = check_orphans(str(wiki_with_pages))
        orphan_pages = [i["page"] for i in issues]
        assert not any("session.md" in p for p in orphan_pages)

    def test_index_not_orphan(self, wiki_with_pages):
        """index.md is never flagged as an orphan."""
        issues = check_orphans(str(wiki_with_pages))
        orphan_pages = [i["page"] for i in issues]
        assert not any("index.md" in p for p in orphan_pages)


# ── Isolated nodes tests ──────────────────────────────────────────


class TestCheckIsolatedNodes:
    def test_detects_isolated(self, wiki_with_pages):
        """Page with degree <= 1 in edges.jsonl is flagged."""
        issues = check_isolated_nodes(str(wiki_with_pages))
        isolated = [i["page"] for i in issues]
        assert any("orphan.md" in p for p in isolated)

    def test_connected_not_flagged(self, wiki_with_pages):
        """Page with degree >= 2 is not flagged."""
        issues = check_isolated_nodes(str(wiki_with_pages))
        isolated = [i["page"] for i in issues]
        assert not any("session.md" in p for p in isolated)


# ── Code ref drift tests ──────────────────────────────────────────


class TestCheckCodeRefDrift:
    def test_hash_mismatch(self, initialized_wiki):
        """Page with wrong content_hash produces a warning."""
        wiki = str(initialized_wiki)
        # Create a source file
        src = initialized_wiki / "src" / "auth.py"
        src.parent.mkdir(parents=True, exist_ok=True)
        src.write_text("def authenticate(): pass\n")
        # Create a page referencing it with wrong hash
        fm = _full_fm(references=[{
            "path": "src/auth.py",
            "lines": [1],
            "symbol": "authenticate",
            "content_hash": "wrong_hash_value",
        }])
        page = str(initialized_wiki / "wiki" / "ref.md")
        _write_page(page, fm, "References auth code.\n")
        issues = check_code_ref_drift(wiki)
        assert len(issues) >= 1
        assert issues[0]["severity"] == "warning"

    def test_matching_hash_no_issue(self, initialized_wiki):
        """Correct hash produces no issue."""
        wiki = str(initialized_wiki)
        src = initialized_wiki / "src" / "auth.py"
        src.parent.mkdir(parents=True, exist_ok=True)
        content = "def authenticate(): pass\n"
        src.write_text(content)
        correct_hash = hashlib.sha256(content.encode()).hexdigest()
        fm = _full_fm(references=[{
            "path": "src/auth.py",
            "lines": [1],
            "symbol": "authenticate",
            "content_hash": correct_hash,
        }])
        page = str(initialized_wiki / "wiki" / "ref.md")
        _write_page(page, fm, "References auth code.\n")
        issues = check_code_ref_drift(wiki)
        ref_issues = [i for i in issues if "ref.md" in i["page"]]
        assert ref_issues == []


# ── Provenance tests ──────────────────────────────────────────────


class TestCheckProvenance:
    def test_edge_missing_provenance(self, initialized_wiki):
        """Edge without provenance field is flagged as error."""
        edges_path = initialized_wiki / "graph" / "edges.jsonl"
        edges_path.write_text(json.dumps({
            "from": "A", "to": "B", "type": "extends"
        }) + "\n")
        issues = check_provenance_completeness(str(initialized_wiki))
        assert len(issues) >= 1
        assert issues[0]["severity"] == "error"

    def test_all_edges_have_provenance(self, wiki_with_pages):
        """All edges with provenance returns no issues."""
        issues = check_provenance_completeness(str(wiki_with_pages))
        assert issues == []


# ── Ambiguity rate tests ──────────────────────────────────────────


class TestCheckAmbiguityRate:
    def test_above_20_percent(self, initialized_wiki):
        """> 20% AMBIGUOUS edges triggers a warning."""
        edges_path = initialized_wiki / "graph" / "edges.jsonl"
        # 3 out of 4 = 75% AMBIGUOUS
        edges = [
            {"from": "A", "to": "B", "type": "extends", "provenance": "AMBIGUOUS"},
            {"from": "B", "to": "C", "type": "extends", "provenance": "AMBIGUOUS"},
            {"from": "C", "to": "D", "type": "extends", "provenance": "AMBIGUOUS"},
            {"from": "D", "to": "E", "type": "extends", "provenance": "EXTRACTED"},
        ]
        with open(edges_path, "w") as f:
            for e in edges:
                f.write(json.dumps(e) + "\n")
        issues = check_high_ambiguity_rate(str(initialized_wiki))
        assert len(issues) >= 1
        assert issues[0]["severity"] == "warning"

    def test_below_20_percent(self, wiki_with_pages):
        """<= 20% AMBIGUOUS returns no warning."""
        # wiki_with_pages has 1 AMBIGUOUS out of 5 = 20%
        issues = check_high_ambiguity_rate(str(wiki_with_pages))
        assert issues == []


# ── lint_wiki integration tests ────────────────────────────────────


class TestLintWiki:
    def test_runs_all_checks(self, wiki_with_pages):
        """Returns issues from multiple categories."""
        result = lint_wiki(str(wiki_with_pages))
        assert "issues" in result
        assert "summary" in result
        categories = {i["category"] for i in result["issues"]}
        assert len(categories) >= 1

    def test_summary_counts(self, wiki_with_pages):
        """Summary has counts by severity."""
        result = lint_wiki(str(wiki_with_pages))
        summary = result["summary"]
        assert "error" in summary
        assert "warning" in summary
        assert "info" in summary

    def test_clean_wiki(self, tmp_path):
        """Fully clean wiki returns zero issues."""
        # Build a minimal clean wiki
        wiki_dir = tmp_path / "wiki"
        wiki_dir.mkdir()
        (tmp_path / "graph").mkdir()
        (tmp_path / "graph" / "edges.jsonl").touch()
        _write_page(
            str(wiki_dir / "index.md"), _full_fm(title="Index", type="index"),
            "# Index\n"
        )
        result = lint_wiki(str(tmp_path))
        assert result["summary"]["error"] == 0


# ── CLI tests ──────────────────────────────────────────────────────

SCRIPT = str(Path(__file__).resolve().parent.parent / "lint_checks.py")


class TestLintChecksCLI:
    def test_cli_full_lint(self, wiki_with_pages):
        """CLI --wiki-root prints JSON with issues and summary."""
        result = subprocess.run(
            [sys.executable, SCRIPT, "--wiki-root", str(wiki_with_pages)],
            capture_output=True, text=True,
        )
        assert result.returncode == 0
        data = json.loads(result.stdout)
        assert "issues" in data
        assert "summary" in data

    def test_cli_category_filter(self, wiki_with_pages):
        """CLI --category runs only that check."""
        result = subprocess.run(
            [sys.executable, SCRIPT, "--wiki-root", str(wiki_with_pages),
             "--category", "broken_links"],
            capture_output=True, text=True,
        )
        assert result.returncode == 0
        data = json.loads(result.stdout)
        categories = {i["category"] for i in data["issues"]}
        assert categories <= {"broken_links"}
