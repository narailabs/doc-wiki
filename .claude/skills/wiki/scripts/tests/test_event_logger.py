"""Tests for event_logger.py — written BEFORE implementation (TDD)."""
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import pytest

# Ensure the scripts package is importable
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from event_logger import log_event, get_stats


# ── Fixtures ────────────────────────────────────────────────────────


@pytest.fixture
def wiki_root(tmp_path):
    """Minimal wiki root with log/ directory pre-created."""
    log_dir = tmp_path / "log"
    log_dir.mkdir()
    return str(tmp_path)


@pytest.fixture
def wiki_root_with_events(wiki_root):
    """Wiki root pre-populated with several events for stats tests."""
    events = [
        {
            "ts": "2026-04-01T10:00:00+00:00",
            "op": "ingest",
            "tokens_in": 1000,
            "tokens_out": 500,
            "cost_usd": 0.05,
            "reduction_ratio": 0.6,
        },
        {
            "ts": "2026-04-05T12:00:00+00:00",
            "op": "query",
            "tokens_in": 200,
            "tokens_out": 800,
            "cost_usd": 0.03,
            "reduction_ratio": 0.4,
        },
        {
            "ts": "2026-04-10T08:00:00+00:00",
            "op": "ingest",
            "tokens_in": 1500,
            "tokens_out": 600,
            "cost_usd": 0.07,
            "reduction_ratio": 0.8,
        },
        {
            "ts": "2026-04-10T14:00:00+00:00",
            "op": "lint",
            "tokens_in": 100,
            "tokens_out": 50,
            "cost_usd": 0.01,
            "reduction_ratio": 0.5,
        },
    ]
    log_path = Path(wiki_root) / "log" / "events.jsonl"
    with open(log_path, "w") as f:
        for e in events:
            f.write(json.dumps(e) + "\n")
    return wiki_root


# ── Core logging tests ──────────────────────────────────────────────


class TestLogEvent:
    def test_log_event_creates_jsonl_entry(self, wiki_root):
        """log_event writes a valid JSON line to log/events.jsonl."""
        log_event(wiki_root, "ingest", {"source": "slides.pptx"})

        log_path = Path(wiki_root) / "log" / "events.jsonl"
        assert log_path.exists()
        lines = log_path.read_text().strip().splitlines()
        assert len(lines) == 1
        entry = json.loads(lines[0])
        assert entry["op"] == "ingest"
        assert entry["source"] == "slides.pptx"

    def test_log_event_includes_timestamp(self, wiki_root):
        """Each entry has an ISO-format timestamp in the 'ts' field."""
        result = log_event(wiki_root, "query", {})
        assert "ts" in result
        # Must parse as a valid ISO timestamp
        parsed = datetime.fromisoformat(result["ts"])
        assert parsed.tzinfo is not None or parsed.year >= 2026

    def test_log_event_includes_operation(self, wiki_root):
        """The 'op' field matches the operation passed in."""
        for op in ("ingest", "query", "lint", "graph_update"):
            result = log_event(wiki_root, op, {})
            assert result["op"] == op

    def test_log_event_appends_not_overwrites(self, wiki_root):
        """Multiple log_event calls append lines, never overwrite."""
        log_event(wiki_root, "ingest", {"batch": 1})
        log_event(wiki_root, "query", {"batch": 2})
        log_event(wiki_root, "lint", {"batch": 3})

        log_path = Path(wiki_root) / "log" / "events.jsonl"
        lines = log_path.read_text().strip().splitlines()
        assert len(lines) == 3
        ops = [json.loads(l)["op"] for l in lines]
        assert ops == ["ingest", "query", "lint"]

    def test_log_event_with_agent_calls(self, wiki_root):
        """agent_calls array is included when provided in details."""
        calls = [
            {"tool": "Read", "duration_ms": 120},
            {"tool": "Grep", "duration_ms": 45},
        ]
        result = log_event(wiki_root, "query", {"agent_calls": calls})
        assert result["agent_calls"] == calls
        assert len(result["agent_calls"]) == 2

    def test_log_event_with_token_metrics(self, wiki_root):
        """tokens_in, tokens_out, cost_usd fields are preserved."""
        details = {
            "tokens_in": 1500,
            "tokens_out": 800,
            "cost_usd": 0.042,
        }
        result = log_event(wiki_root, "ingest", details)
        assert result["tokens_in"] == 1500
        assert result["tokens_out"] == 800
        assert result["cost_usd"] == pytest.approx(0.042)

    def test_missing_log_file_creates_it(self, tmp_path):
        """If events.jsonl does not exist, log_event creates it (and log/ dir)."""
        bare_root = str(tmp_path / "fresh-wiki")
        # Neither the dir nor the file exist
        assert not Path(bare_root).exists()

        result = log_event(bare_root, "ingest", {"note": "first"})
        log_path = Path(bare_root) / "log" / "events.jsonl"
        assert log_path.exists()
        assert result["op"] == "ingest"


# ── Stats tests ─────────────────────────────────────────────────────


class TestGetStats:
    def test_stats_aggregation(self, wiki_root_with_events):
        """get_stats computes total ops, total cost, and reduction_ratio stats."""
        stats = get_stats(wiki_root_with_events)

        # Total operations by type
        assert stats["ops_by_type"]["ingest"] == 2
        assert stats["ops_by_type"]["query"] == 1
        assert stats["ops_by_type"]["lint"] == 1
        assert stats["total_ops"] == 4

        # Total cost
        assert stats["total_cost_usd"] == pytest.approx(0.16)

        # Reduction ratio stats (values: 0.6, 0.4, 0.8, 0.5)
        assert stats["reduction_ratio"]["mean"] == pytest.approx(0.575)
        # p50 of [0.4, 0.5, 0.6, 0.8] = average of 0.5 and 0.6 = 0.55
        assert stats["reduction_ratio"]["p50"] == pytest.approx(0.55)
        # p95 should be close to 0.8
        assert stats["reduction_ratio"]["p95"] == pytest.approx(0.8, abs=0.05)

    def test_stats_with_since_filter(self, wiki_root_with_events):
        """Only includes events after the given ISO date string."""
        # Only events on or after 2026-04-10
        stats = get_stats(wiki_root_with_events, since="2026-04-09T00:00:00+00:00")

        assert stats["total_ops"] == 2
        assert stats["ops_by_type"]["ingest"] == 1
        assert stats["ops_by_type"]["lint"] == 1
        assert "query" not in stats["ops_by_type"]
        assert stats["total_cost_usd"] == pytest.approx(0.08)
