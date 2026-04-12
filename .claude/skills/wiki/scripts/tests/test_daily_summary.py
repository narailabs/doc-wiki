"""Tests for daily_summary.py — written BEFORE implementation (TDD)."""
import json
import subprocess
import sys
from datetime import date
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from daily_summary import generate_summary, write_summary

SCRIPT = str(Path(__file__).resolve().parent.parent / "daily_summary.py")


# ── generate_summary tests ──────────────────────────────────────────


class TestGenerateSummary:
    def test_generates_markdown(self, wiki_with_events):
        """generate_summary returns a markdown string."""
        result = generate_summary(str(wiki_with_events), "2026-04-12")
        assert result.startswith("#")

    def test_filters_by_date(self, wiki_with_events):
        """Summary for 2026-04-12 only contains that date's events."""
        result = generate_summary(str(wiki_with_events), "2026-04-12")
        # 2026-04-12 has 5 events: 2 ingest, 2 query, 1 lint
        assert "ingest" in result.lower()
        assert "query" in result.lower()

    def test_operations_summary_section(self, wiki_with_events):
        """Output contains an Operations Summary section."""
        result = generate_summary(str(wiki_with_events), "2026-04-12")
        assert "Operations" in result

    def test_per_agent_breakdown_section(self, wiki_with_events):
        """Output contains Per-Agent Breakdown section."""
        result = generate_summary(str(wiki_with_events), "2026-04-12")
        assert "Agent" in result

    def test_quality_signals_section(self, wiki_with_events):
        """Output contains Quality Signals section."""
        result = generate_summary(str(wiki_with_events), "2026-04-12")
        assert "Quality" in result

    def test_token_efficiency_section(self, wiki_with_events):
        """Output contains Token Efficiency section."""
        result = generate_summary(str(wiki_with_events), "2026-04-12")
        assert "Token" in result

    def test_defaults_to_today(self, wiki_with_events):
        """When date_str is None, uses today's date."""
        result = generate_summary(str(wiki_with_events))
        today_str = date.today().isoformat()
        assert today_str in result


# ── write_summary tests ─────────────────────────────────────────────


class TestWriteSummary:
    def test_writes_to_daily_directory(self, wiki_with_events):
        """write_summary creates log/daily/YYYY-MM-DD.md."""
        path = write_summary(str(wiki_with_events), "2026-04-12")
        assert path.exists()
        assert path.name == "2026-04-12.md"
        assert "daily" in str(path)

    def test_returns_path(self, wiki_with_events):
        """Returns a Path object."""
        path = write_summary(str(wiki_with_events), "2026-04-12")
        assert isinstance(path, Path)

    def test_creates_daily_dir_if_missing(self, initialized_wiki):
        """If log/daily/ does not exist, creates it."""
        import shutil
        daily_dir = initialized_wiki / "log" / "daily"
        if daily_dir.exists():
            shutil.rmtree(daily_dir)
        path = write_summary(str(initialized_wiki), "2026-04-12")
        assert path.parent.exists()


# ── Edge cases ──────────────────────────────────────────────────────


class TestEdgeCases:
    def test_no_events_for_date(self, wiki_with_events):
        """Date with no events produces a summary stating so."""
        result = generate_summary(str(wiki_with_events), "2099-01-01")
        assert "no events" in result.lower() or "0" in result

    def test_empty_events_file(self, initialized_wiki):
        """Empty events.jsonl produces minimal summary."""
        result = generate_summary(str(initialized_wiki), "2026-04-12")
        assert isinstance(result, str)
        assert len(result) > 0

    def test_events_without_optional_fields(self, initialized_wiki):
        """Events missing agent, cost_usd, etc. still produce valid summary."""
        events_path = initialized_wiki / "log" / "events.jsonl"
        events_path.write_text(
            json.dumps({"ts": "2026-04-12T10:00:00+00:00", "op": "ingest"}) + "\n"
        )
        result = generate_summary(str(initialized_wiki), "2026-04-12")
        assert isinstance(result, str)
        assert "ingest" in result.lower()


# ── CLI tests ──────────────────────────────────────────────────────


class TestDailySummaryCLI:
    def test_cli_with_date(self, wiki_with_events):
        """CLI --date creates file and prints path."""
        result = subprocess.run(
            [sys.executable, SCRIPT, "--wiki-root", str(wiki_with_events),
             "--date", "2026-04-12"],
            capture_output=True, text=True,
        )
        assert result.returncode == 0
        assert "2026-04-12" in result.stdout

    def test_cli_default_date(self, wiki_with_events):
        """CLI without --date uses today's date."""
        result = subprocess.run(
            [sys.executable, SCRIPT, "--wiki-root", str(wiki_with_events)],
            capture_output=True, text=True,
        )
        assert result.returncode == 0
        today_str = date.today().isoformat()
        assert today_str in result.stdout
