#!/usr/bin/env python3
"""Event logger for the documentation wiki.

Logs structured events to log/events.jsonl and computes aggregate statistics.

Usage as a library:
    from event_logger import log_event, get_stats
    log_event("/path/to/wiki", "ingest", {"source": "slides.pptx", "cost_usd": 0.05})
    stats = get_stats("/path/to/wiki", since="2026-04-01T00:00:00+00:00")

Usage as a script:
    python event_logger.py --op ingest --wiki-root /path/to/wiki --details '{"source":"slides.pptx"}'
    python event_logger.py stats --wiki-root /path/to/wiki --since 7d
"""
import argparse
import json
import re
import statistics
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path


def _events_path(wiki_root: str) -> Path:
    """Return the path to log/events.jsonl, creating directories if needed."""
    p = Path(wiki_root) / "log" / "events.jsonl"
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


def log_event(wiki_root: str, op: str, details: dict) -> dict:
    """Append a JSON-line event to log/events.jsonl.

    Auto-adds an ISO timestamp in the ``ts`` field.
    All keys from *details* are merged into the top-level entry.

    Returns the full logged entry dict.
    """
    entry = {"ts": datetime.now(timezone.utc).isoformat(), "op": op}
    entry.update(details)

    path = _events_path(wiki_root)
    with open(path, "a") as f:
        f.write(json.dumps(entry) + "\n")

    return entry


def _read_events(wiki_root: str, since: str = None) -> list[dict]:
    """Read events from log/events.jsonl, optionally filtered by timestamp."""
    path = _events_path(wiki_root)
    if not path.exists():
        return []

    events = []
    since_dt = datetime.fromisoformat(since) if since else None

    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            entry = json.loads(line)
            if since_dt is not None:
                entry_dt = datetime.fromisoformat(entry.get("ts", ""))
                if entry_dt < since_dt:
                    continue
            events.append(entry)
    return events


def _parse_relative_since(since_str: str) -> str:
    """Convert a relative duration like '7d' or '24h' to an ISO timestamp."""
    match = re.match(r"^(\d+)([dhm])$", since_str)
    if not match:
        # Assume it is already an ISO string
        return since_str
    value, unit = int(match.group(1)), match.group(2)
    if unit == "d":
        delta = timedelta(days=value)
    elif unit == "h":
        delta = timedelta(hours=value)
    elif unit == "m":
        delta = timedelta(minutes=value)
    else:
        return since_str
    return (datetime.now(timezone.utc) - delta).isoformat()


def get_stats(wiki_root: str, since: str = None) -> dict:
    """Compute aggregate statistics from the event log.

    Returns a dict with:
        total_ops: int
        ops_by_type: dict[str, int]
        total_cost_usd: float
        reduction_ratio: {mean, p50, p95}
        per_agent_cost: dict[str, float]  (if agent info present)
    """
    events = _read_events(wiki_root, since=since)

    ops_by_type: dict[str, int] = {}
    total_cost = 0.0
    ratios: list[float] = []
    per_agent_cost: dict[str, float] = {}

    for e in events:
        op = e.get("op", "unknown")
        ops_by_type[op] = ops_by_type.get(op, 0) + 1

        cost = e.get("cost_usd", 0.0)
        total_cost += cost

        if "reduction_ratio" in e:
            ratios.append(e["reduction_ratio"])

        agent = e.get("agent")
        if agent:
            per_agent_cost[agent] = per_agent_cost.get(agent, 0.0) + cost

    # Reduction ratio statistics
    ratio_stats: dict = {}
    if ratios:
        sorted_ratios = sorted(ratios)
        ratio_stats["mean"] = statistics.mean(ratios)
        ratio_stats["p50"] = statistics.median(ratios)
        # p95: use nearest-rank method
        idx_95 = int(len(sorted_ratios) * 0.95)
        idx_95 = min(idx_95, len(sorted_ratios) - 1)
        ratio_stats["p95"] = sorted_ratios[idx_95]

    return {
        "total_ops": len(events),
        "ops_by_type": ops_by_type,
        "total_cost_usd": total_cost,
        "reduction_ratio": ratio_stats,
        "per_agent_cost": per_agent_cost,
    }


# ── CLI ─────────────────────────────────────────────────────────────


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Wiki event logger and stats tool."
    )
    sub = parser.add_subparsers(dest="command")

    # Default: log an event
    log_parser = sub.add_parser("log", help="Log an event")
    log_parser.add_argument("--op", required=True, help="Operation name")
    log_parser.add_argument("--wiki-root", required=True, help="Wiki root path")
    log_parser.add_argument("--details", default="{}", help="JSON details string")

    # Stats sub-command
    stats_parser = sub.add_parser("stats", help="Show aggregated stats")
    stats_parser.add_argument("--wiki-root", required=True, help="Wiki root path")
    stats_parser.add_argument("--since", default=None,
                              help="Only events after this time (ISO or relative e.g. 7d)")

    return parser


def main(argv: list[str] = None) -> None:
    parser = _build_parser()

    # Support bare --op usage (no sub-command) for convenience
    args, unknown = parser.parse_known_args(argv)

    if args.command == "stats":
        since = _parse_relative_since(args.since) if args.since else None
        result = get_stats(args.wiki_root, since=since)
        print(json.dumps(result, indent=2))
    elif args.command == "log":
        details = json.loads(args.details)
        entry = log_event(args.wiki_root, args.op, details)
        print(json.dumps(entry, indent=2))
    else:
        # Fallback: try --op style
        fallback = argparse.ArgumentParser()
        fallback.add_argument("--op", required=True)
        fallback.add_argument("--wiki-root", required=True)
        fallback.add_argument("--details", default="{}")
        fargs = fallback.parse_args(argv)
        details = json.loads(fargs.details)
        entry = log_event(fargs.wiki_root, fargs.op, details)
        print(json.dumps(entry, indent=2))


if __name__ == "__main__":
    main()
