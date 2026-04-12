"""Tests for quality_score.py — written BEFORE implementation (TDD)."""
import json
import subprocess
import sys
from pathlib import Path

import pytest
import yaml

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from quality_score import score_page, score_wiki

# ── Helpers ─────────────────────────────────────────────────────────


def _write_page(path, frontmatter, body):
    """Write a wiki page with YAML frontmatter + body text."""
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    content = "---\n" + yaml.dump(frontmatter) + "---\n\n" + body
    Path(path).write_text(content)


def _full_frontmatter(**overrides):
    """Return a complete frontmatter dict with all 8 required fields."""
    fm = {
        "title": "Test Page",
        "type": "concept",
        "tags": ["auth", "jwt", "sessions", "security"],
        "sources": ["raw/test.md"],
        "created": "2026-04-12",
        "updated": "2026-04-12",
        "quality": 0.0,
        "summary": "A test page for quality scoring.",
    }
    fm.update(overrides)
    return fm


# ── Fixtures ────────────────────────────────────────────────────────


@pytest.fixture
def edges_file(tmp_path):
    """Empty edges.jsonl for scoring."""
    p = tmp_path / "graph" / "edges.jsonl"
    p.parent.mkdir(parents=True)
    p.touch()
    return str(p)


@pytest.fixture
def edges_with_god_node(tmp_path):
    """edges.jsonl where 'wiki/hub.md' is a god-node (high degree)."""
    p = tmp_path / "graph" / "edges.jsonl"
    p.parent.mkdir(parents=True)
    edges = []
    # hub.md connects to 10 pages (degree 10) — clearly top 10%
    for i in range(10):
        edges.append({"from": "wiki/hub.md", "to": f"wiki/page{i}.md",
                       "type": "extends", "provenance": "EXTRACTED"})
    # Two other nodes with degree 1
    edges.append({"from": "wiki/lonely.md", "to": "wiki/page0.md",
                   "type": "supports", "provenance": "EXTRACTED"})
    with open(p, "w") as f:
        for e in edges:
            f.write(json.dumps(e) + "\n")
    return str(p)


# ── Word count base score tests ─────────────────────────────────────


class TestScorePage:
    def test_word_count_below_50_base_01(self, tmp_path, edges_file):
        """Page with < 50 words gets 0.1 base score."""
        page = str(tmp_path / "wiki" / "short.md")
        _write_page(page, _full_frontmatter(), "Short " * 10)
        result = score_page(page, edges_file)
        # Base 0.1 + frontmatter 0.1 + tags 0.05 = 0.25 (no links penalty doesn't exist, just no bonus)
        assert result["quality"] == pytest.approx(0.25, abs=0.01)

    def test_word_count_50_to_150_base_03(self, tmp_path, edges_file):
        """Page with 50-150 words gets 0.3 base."""
        page = str(tmp_path / "wiki" / "medium.md")
        _write_page(page, _full_frontmatter(), " ".join(["word"] * 80))
        result = score_page(page, edges_file)
        # Base 0.3 + frontmatter 0.1 + tags 0.05 = 0.45
        assert result["quality"] == pytest.approx(0.45, abs=0.01)

    def test_word_count_150_to_500_base_06(self, tmp_path, edges_file):
        """Page with 150-500 words gets 0.6 base."""
        page = str(tmp_path / "wiki" / "good.md")
        _write_page(page, _full_frontmatter(), " ".join(["word"] * 200))
        result = score_page(page, edges_file)
        # Base 0.6 + frontmatter 0.1 + tags 0.05 = 0.75
        assert result["quality"] == pytest.approx(0.75, abs=0.01)

    def test_word_count_above_500_base_08(self, tmp_path, edges_file):
        """Page with 500+ words gets 0.8 base."""
        page = str(tmp_path / "wiki" / "long.md")
        _write_page(page, _full_frontmatter(), " ".join(["word"] * 600))
        result = score_page(page, edges_file)
        # Base 0.8 + frontmatter 0.1 + tags 0.05 = 0.95
        assert result["quality"] == pytest.approx(0.95, abs=0.01)

    def test_complete_frontmatter_bonus(self, tmp_path, edges_file):
        """Page with all 8 required fields gets +0.1."""
        page = str(tmp_path / "wiki" / "complete.md")
        _write_page(page, _full_frontmatter(), " ".join(["word"] * 200))
        result = score_page(page, edges_file)
        signals = {s["signal"]: s["delta"] for s in result["signals"]}
        assert "complete_frontmatter" in signals
        assert signals["complete_frontmatter"] == pytest.approx(0.1)

    def test_missing_title_penalty(self, tmp_path, edges_file):
        """Page with no title gets -0.3."""
        fm = _full_frontmatter()
        del fm["title"]
        page = str(tmp_path / "wiki" / "notitle.md")
        _write_page(page, fm, " ".join(["word"] * 200))
        result = score_page(page, edges_file)
        signals = {s["signal"]: s["delta"] for s in result["signals"]}
        assert "missing_title" in signals
        assert signals["missing_title"] == pytest.approx(-0.3)

    def test_no_sources_penalty(self, tmp_path, edges_file):
        """Page with empty sources gets -0.2."""
        page = str(tmp_path / "wiki" / "nosrc.md")
        _write_page(page, _full_frontmatter(sources=[]), " ".join(["word"] * 200))
        result = score_page(page, edges_file)
        signals = {s["signal"]: s["delta"] for s in result["signals"]}
        assert "no_sources" in signals
        assert signals["no_sources"] == pytest.approx(-0.2)

    def test_no_summary_penalty(self, tmp_path, edges_file):
        """Page with missing summary gets -0.1."""
        fm = _full_frontmatter()
        del fm["summary"]
        page = str(tmp_path / "wiki" / "nosum.md")
        _write_page(page, fm, " ".join(["word"] * 200))
        result = score_page(page, edges_file)
        signals = {s["signal"]: s["delta"] for s in result["signals"]}
        assert "no_summary" in signals
        assert signals["no_summary"] == pytest.approx(-0.1)

    def test_crossref_links_bonus(self, tmp_path, edges_file):
        """Page with 3+ relative .md links gets +0.1."""
        page = str(tmp_path / "wiki" / "linked.md")
        body = (
            "See [auth](auth.md) and [jwt](jwt.md) and [db](db.md). "
            + " ".join(["word"] * 200)
        )
        _write_page(page, _full_frontmatter(), body)
        result = score_page(page, edges_file)
        signals = {s["signal"]: s["delta"] for s in result["signals"]}
        assert "crossref_links" in signals
        assert signals["crossref_links"] == pytest.approx(0.1)

    def test_concept_tags_bonus(self, tmp_path, edges_file):
        """Page with 4+ tags gets +0.05."""
        page = str(tmp_path / "wiki" / "tagged.md")
        _write_page(page, _full_frontmatter(tags=["a", "b", "c", "d"]),
                     " ".join(["word"] * 200))
        result = score_page(page, edges_file)
        signals = {s["signal"]: s["delta"] for s in result["signals"]}
        assert "concept_tags" in signals
        assert signals["concept_tags"] == pytest.approx(0.05)


# ── Claims tests ────────────────────────────────────────────────────


class TestScorePageClaims:
    def test_claim_with_evidence_bonus(self, tmp_path, edges_file):
        """Claim page with evidence list gets +0.1."""
        fm = _full_frontmatter(
            type="claim",
            status="supported",
            confidence=0.8,
            evidence=[{"source": "raw/paper.md", "type": "supports",
                        "strength": "strong", "detail": "found in section 3"}],
        )
        page = str(tmp_path / "wiki" / "claims" / "claim1.md")
        _write_page(page, fm, " ".join(["word"] * 200))
        result = score_page(page, edges_file)
        signals = {s["signal"]: s["delta"] for s in result["signals"]}
        assert "claim_has_evidence" in signals
        assert signals["claim_has_evidence"] == pytest.approx(0.1)

    def test_deprecated_without_failure_reason(self, tmp_path, edges_file):
        """Deprecated claim without failure_reason gets -0.2."""
        fm = _full_frontmatter(
            type="claim", status="deprecated", confidence=0.1,
            failure_reason="",
        )
        page = str(tmp_path / "wiki" / "claims" / "old.md")
        _write_page(page, fm, " ".join(["word"] * 200))
        result = score_page(page, edges_file)
        signals = {s["signal"]: s["delta"] for s in result["signals"]}
        assert "deprecated_no_reason" in signals
        assert signals["deprecated_no_reason"] == pytest.approx(-0.2)

    def test_deprecated_with_failure_reason_no_penalty(self, tmp_path, edges_file):
        """Deprecated claim with failure_reason does NOT get -0.2."""
        fm = _full_frontmatter(
            type="claim", status="deprecated", confidence=0.1,
            failure_reason="Superseded by new evidence",
        )
        page = str(tmp_path / "wiki" / "claims" / "explained.md")
        _write_page(page, fm, " ".join(["word"] * 200))
        result = score_page(page, edges_file)
        signals = {s["signal"]: s["delta"] for s in result["signals"]}
        assert "deprecated_no_reason" not in signals


# ── Structural signal tests ─────────────────────────────────────────


class TestScorePageStructural:
    def test_god_node_bonus(self, tmp_path, edges_with_god_node):
        """Page in top 10% by degree gets +0.1."""
        page = str(tmp_path / "wiki" / "hub.md")
        _write_page(page, _full_frontmatter(), " ".join(["word"] * 200))
        result = score_page(page, edges_with_god_node)
        signals = {s["signal"]: s["delta"] for s in result["signals"]}
        assert "god_node" in signals
        assert signals["god_node"] == pytest.approx(0.1)

    def test_isolated_node_penalty(self, tmp_path, edges_with_god_node):
        """Page with degree <= 1 gets -0.2."""
        page = str(tmp_path / "wiki" / "lonely.md")
        _write_page(page, _full_frontmatter(), " ".join(["word"] * 200))
        result = score_page(page, edges_with_god_node)
        signals = {s["signal"]: s["delta"] for s in result["signals"]}
        assert "isolated_node" in signals
        assert signals["isolated_node"] == pytest.approx(-0.2)

    def test_has_mermaid_bonus(self, tmp_path, edges_file):
        """Page with mermaid code block gets +0.05."""
        page = str(tmp_path / "wiki" / "diag.md")
        body = " ".join(["word"] * 200) + "\n\n```mermaid\nerDiagram\n    A ||--o{ B : has\n```\n"
        _write_page(page, _full_frontmatter(), body)
        result = score_page(page, edges_file)
        signals = {s["signal"]: s["delta"] for s in result["signals"]}
        assert "has_mermaid" in signals
        assert signals["has_mermaid"] == pytest.approx(0.05)

    def test_missing_mermaid_penalty(self, tmp_path, edges_file):
        """Entity page about DB without mermaid gets -0.1 info penalty."""
        fm = _full_frontmatter(type="entity",
                                tags=["database", "schema", "postgresql"])
        page = str(tmp_path / "wiki" / "db" / "tables.md")
        _write_page(page, fm, " ".join(["word"] * 200))
        result = score_page(page, edges_file)
        signals = {s["signal"]: s["delta"] for s in result["signals"]}
        assert "missing_mermaid" in signals
        assert signals["missing_mermaid"] == pytest.approx(-0.1)


# ── Clamping tests ──────────────────────────────────────────────────


class TestScorePageClamping:
    def test_clamped_to_zero(self, tmp_path, edges_file):
        """Page that would score negative clamps to 0.0."""
        # Base 0.1 (short) - 0.3 (no title) - 0.2 (no sources) - 0.1 (no summary) = -0.5
        page = str(tmp_path / "wiki" / "terrible.md")
        _write_page(page, {"type": "concept"}, "Short.")
        result = score_page(page, edges_file)
        assert result["quality"] == 0.0

    def test_clamped_to_one(self, tmp_path, edges_with_god_node):
        """Page that would score above 1.0 clamps to 1.0."""
        # Build a page that hits every bonus
        body = (
            " ".join(["word"] * 600)
            + "\nSee [a](a.md) and [b](b.md) and [c](c.md).\n"
            + "\n```mermaid\nerDiagram\n    X ||--o{ Y : has\n```\n"
        )
        page = str(tmp_path / "wiki" / "hub.md")
        fm = _full_frontmatter(
            type="claim", status="supported",
            evidence=[{"source": "x", "type": "supports",
                        "strength": "strong", "detail": "y"}],
        )
        _write_page(page, fm, body)
        result = score_page(page, edges_with_god_node)
        assert result["quality"] <= 1.0


# ── Output structure tests ──────────────────────────────────────────


class TestScorePageOutput:
    def test_returns_quality_and_signals(self, tmp_path, edges_file):
        """Return dict has 'quality' (float) and 'signals' (list)."""
        page = str(tmp_path / "wiki" / "test.md")
        _write_page(page, _full_frontmatter(), " ".join(["word"] * 200))
        result = score_page(page, edges_file)
        assert isinstance(result["quality"], float)
        assert isinstance(result["signals"], list)

    def test_signals_have_signal_and_delta(self, tmp_path, edges_file):
        """Each signal entry has 'signal' and 'delta' keys."""
        page = str(tmp_path / "wiki" / "test.md")
        _write_page(page, _full_frontmatter(), " ".join(["word"] * 200))
        result = score_page(page, edges_file)
        for s in result["signals"]:
            assert "signal" in s
            assert "delta" in s


# ── score_wiki tests ────────────────────────────────────────────────


class TestScoreWiki:
    def test_returns_sorted_list(self, wiki_with_pages):
        """score_wiki returns list sorted by quality descending."""
        results = score_wiki(str(wiki_with_pages))
        assert isinstance(results, list)
        assert len(results) >= 2
        qualities = [r["quality"] for r in results]
        assert qualities == sorted(qualities, reverse=True)

    def test_includes_all_pages(self, wiki_with_pages):
        """Every .md file under wiki/ is scored."""
        results = score_wiki(str(wiki_with_pages))
        pages = {r["page"] for r in results}
        # wiki_with_pages has: index.md, auth/session.md, auth/jwt.md,
        # db/schema.md, orphan.md, broken.md, summaries.md, overview.md
        assert len(pages) >= 5

    def test_empty_wiki(self, initialized_wiki):
        """Wiki with only index/summaries/overview returns those scored."""
        results = score_wiki(str(initialized_wiki))
        assert isinstance(results, list)


# ── CLI tests ──────────────────────────────────────────────────────

SCRIPT = str(Path(__file__).resolve().parent.parent / "quality_score.py")


class TestQualityScoreCLI:
    def test_cli_single_page(self, tmp_path, edges_file):
        """CLI --page prints JSON with quality and signals."""
        page = str(tmp_path / "wiki" / "test.md")
        _write_page(page, _full_frontmatter(), " ".join(["word"] * 200))
        result = subprocess.run(
            [sys.executable, SCRIPT, "--page", page, "--edges", edges_file],
            capture_output=True, text=True,
        )
        assert result.returncode == 0
        data = json.loads(result.stdout)
        assert "quality" in data
        assert "signals" in data

    def test_cli_wiki_root(self, wiki_with_pages):
        """CLI --wiki-root prints JSON list of all page scores."""
        result = subprocess.run(
            [sys.executable, SCRIPT, "--wiki-root", str(wiki_with_pages)],
            capture_output=True, text=True,
        )
        assert result.returncode == 0
        data = json.loads(result.stdout)
        assert isinstance(data, list)
        assert len(data) >= 5
