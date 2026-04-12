#!/usr/bin/env python3
"""Generate daily summary from events.jsonl.

Reads log/events.jsonl, filters events for a given date, and writes a
human-readable markdown summary to log/daily/YYYY-MM-DD.md.

Usage as a library:
    from daily_summary import generate_summary, write_summary
    md = generate_summary("/path/to/wiki", "2026-04-12")
    path = write_summary("/path/to/wiki", "2026-04-12")

Usage as a script:
    python daily_summary.py --wiki-root /path [--date 2026-04-12]
"""
from __future__ import annotations

import argparse
import json
import statistics
import sys
from collections import defaultdict
from datetime import date
from pathlib import Path

# ── Helpers ─────────────────────────────────────────────────────────


def _read_events(wiki_root: str, date_str: str) -> list[dict]:
    """Read events from log/events.jsonl filtered by date prefix."""
    events_path = Path(wiki_root) / "log" / "events.jsonl"
    if not events_path.exists():
        return []
    events = []
    with open(events_path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                continue
            ts = entry.get("ts", "")
            if ts.startswith(date_str):
                events.append(entry)
    return events


# ── Library API ─────────────────────────────────────────────────────


def generate_summary(wiki_root: str, date_str: str = None) -> str:
    """Generate a markdown daily summary for a given date.

    If *date_str* is None, defaults to today's date.
    """
    if date_str is None:
        date_str = date.today().isoformat()

    events = _read_events(wiki_root, date_str)

    lines = [f"# Daily Summary -- {date_str}", ""]

    if not events:
        lines.append("No events recorded for this date.")
        return "\n".join(lines)

    # ── Operations Summary ──────────────────────────────────────
    lines.append("## Operations Summary")
    lines.append("")

    ops_count: dict[str, int] = defaultdict(int)
    for e in events:
        ops_count[e.get("op", "unknown")] += 1

    lines.append("| Operation | Count |")
    lines.append("|-----------|-------|")
    for op, count in sorted(ops_count.items()):
        lines.append(f"| {op} | {count} |")
    lines.append("")
    lines.append(f"**Total operations:** {len(events)}")
    lines.append("")

    # ── Per-Agent Breakdown ─────────────────────────────────────
    lines.append("## Per-Agent Breakdown")
    lines.append("")

    agent_stats: dict[str, dict] = defaultdict(lambda: {"count": 0, "cost": 0.0})
    for e in events:
        agent = e.get("agent")
        if agent:
            agent_stats[agent]["count"] += 1
            agent_stats[agent]["cost"] += e.get("cost_usd", 0.0)

    if agent_stats:
        lines.append("| Agent | Operations | Cost (USD) |")
        lines.append("|-------|-----------|------------|")
        for agent, stats in sorted(agent_stats.items()):
            lines.append(f"| {agent} | {stats['count']} | ${stats['cost']:.4f} |")
    else:
        lines.append("No agent-specific data recorded.")
    lines.append("")

    # ── Quality Signals ─────────────────────────────────────────
    lines.append("## Quality Signals")
    lines.append("")

    lint_events = [e for e in events if e.get("op") == "lint"]
    ingest_events = [e for e in events if e.get("op") == "ingest"]
    lines.append(f"- **Pages ingested:** {len(ingest_events)}")
    lines.append(f"- **Lint checks run:** {len(lint_events)}")
    lines.append("")

    # ── Token Efficiency ────────────────────────────────────────
    lines.append("## Token Efficiency")
    lines.append("")

    total_in = sum(e.get("tokens_in", 0) for e in events)
    total_out = sum(e.get("tokens_out", 0) for e in events)
    total_cost = sum(e.get("cost_usd", 0.0) for e in events)
    ratios = [e["reduction_ratio"] for e in events if "reduction_ratio" in e]

    lines.append(f"- **Total tokens in:** {total_in:,}")
    lines.append(f"- **Total tokens out:** {total_out:,}")
    lines.append(f"- **Total cost:** ${total_cost:.4f}")

    if ratios:
        lines.append(f"- **Reduction ratio (mean):** {statistics.mean(ratios):.1f}x")
        lines.append(f"- **Reduction ratio (median):** {statistics.median(ratios):.1f}x")
    lines.append("")

    return "\n".join(lines)


def write_summary(wiki_root: str, date_str: str = None) -> Path:
    """Generate and write a daily summary to log/daily/YYYY-MM-DD.md.

    Returns the Path to the written file.
    """
    if date_str is None:
        date_str = date.today().isoformat()

    content = generate_summary(wiki_root, date_str)
    daily_dir = Path(wiki_root) / "log" / "daily"
    daily_dir.mkdir(parents=True, exist_ok=True)
    output_path = daily_dir / f"{date_str}.md"
    output_path.write_text(content)
    return output_path


# ── CLI ─────────────────────────────────────────────────────────────


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Generate daily summary from events.")
    parser.add_argument("--wiki-root", required=True, help="Wiki root path")
    parser.add_argument("--date", default=None, help="Date (YYYY-MM-DD), defaults to today")
    return parser


def main(argv: list[str] = None) -> None:
    parser = _build_parser()
    args = parser.parse_args(argv)
    path = write_summary(args.wiki_root, args.date)
    print(f"Summary written to: {path}")


if __name__ == "__main__":
    main()
