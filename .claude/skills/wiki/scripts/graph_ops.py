#!/usr/bin/env python3
"""Knowledge-graph edge operations for the documentation wiki.

Manages typed, provenanced edges in an edges.jsonl file and provides
graph-analysis utilities (degrees, god nodes, path finding).

Usage as a library:
    from graph_ops import add_edge, shortest_path, god_nodes
    add_edge("graph/edges.jsonl", "A.md", "B.md", "extends", "EXTRACTED")
    path = shortest_path("graph/edges.jsonl", "A.md", "C.md")

Usage as a script:
    python graph_ops.py add --edges graph/edges.jsonl --from A --to B --type extends --provenance EXTRACTED
    python graph_ops.py path --edges graph/edges.jsonl --from A --to D --max-hops 6
    python graph_ops.py degrees --edges graph/edges.jsonl
    python graph_ops.py god-nodes --edges graph/edges.jsonl --top 10
"""
import argparse
import json
import sys
from collections import defaultdict
from datetime import date, timezone, datetime
from pathlib import Path

import networkx as nx

# ── Constants ───────────────────────────────────────────────────────

VALID_EDGE_TYPES = {"supports", "contradicts", "extends", "supersedes"}
VALID_PROVENANCE = {"EXTRACTED", "INFERRED", "AMBIGUOUS"}

# ── Edge CRUD ───────────────────────────────────────────────────────


def _read_all_edges(edges_path: str) -> list[dict]:
    """Read every edge from the JSONL file."""
    p = Path(edges_path)
    if not p.exists() or p.stat().st_size == 0:
        return []
    edges = []
    with open(p) as f:
        for line in f:
            line = line.strip()
            if line:
                edges.append(json.loads(line))
    return edges


def _write_all_edges(edges_path: str, edges: list[dict]) -> None:
    """Overwrite the JSONL file with the given edges."""
    with open(edges_path, "w") as f:
        for e in edges:
            f.write(json.dumps(e) + "\n")


def add_edge(
    edges_path: str,
    from_page: str,
    to_page: str,
    edge_type: str,
    provenance: str,
    evidence: str = "",
    source_file: str = "",
) -> dict:
    """Append a typed, provenanced edge to edges.jsonl.

    Raises ValueError if edge_type or provenance is invalid.
    Returns the edge dict that was written.
    """
    if edge_type not in VALID_EDGE_TYPES:
        raise ValueError(
            f"Invalid edge type '{edge_type}'. Must be one of: {sorted(VALID_EDGE_TYPES)}"
        )
    if provenance not in VALID_PROVENANCE:
        raise ValueError(
            f"Invalid provenance '{provenance}'. Must be one of: {sorted(VALID_PROVENANCE)}"
        )

    edge = {
        "from": from_page,
        "to": to_page,
        "type": edge_type,
        "provenance": provenance,
        "evidence": evidence,
        "source_file": source_file,
        "date": date.today().isoformat(),
    }

    with open(edges_path, "a") as f:
        f.write(json.dumps(edge) + "\n")

    return edge


def remove_edge(
    edges_path: str, from_page: str, to_page: str, edge_type: str
) -> bool:
    """Remove the first edge matching from/to/type. Returns True if removed."""
    edges = _read_all_edges(edges_path)
    new_edges = []
    removed = False
    for e in edges:
        if (
            not removed
            and e["from"] == from_page
            and e["to"] == to_page
            and e["type"] == edge_type
        ):
            removed = True
            continue
        new_edges.append(e)

    if removed:
        _write_all_edges(edges_path, new_edges)
    return removed


def list_edges(edges_path: str, edge_type: str = None) -> list[dict]:
    """Return all edges, optionally filtered by type."""
    edges = _read_all_edges(edges_path)
    if edge_type is not None:
        edges = [e for e in edges if e["type"] == edge_type]
    return edges


# ── Degree analysis ─────────────────────────────────────────────────


def compute_degrees(edges_path: str) -> dict[str, int]:
    """Compute the degree (in-degree + out-degree) for every node."""
    edges = _read_all_edges(edges_path)
    degrees: dict[str, int] = defaultdict(int)
    for e in edges:
        degrees[e["from"]] += 1
        degrees[e["to"]] += 1
    return dict(degrees)


def god_nodes(
    edges_path: str,
    top_n: int = 10,
    exclude_types: list[str] = None,
) -> list[tuple[str, int]]:
    """Return the top-N highest-degree nodes.

    Nodes whose names contain any of *exclude_types* (case-insensitive)
    are filtered out.  Default exclusions: Index, Summary.
    """
    if exclude_types is None:
        exclude_types = ["Index", "Summary"]

    degrees = compute_degrees(edges_path)

    # Filter out excluded types
    exclude_lower = [t.lower() for t in exclude_types]
    filtered = {
        node: deg
        for node, deg in degrees.items()
        if not any(ex in node.lower() for ex in exclude_lower)
    }

    sorted_nodes = sorted(filtered.items(), key=lambda x: x[1], reverse=True)
    return sorted_nodes[:top_n]


def isolated_nodes(edges_path: str, all_pages: list[str]) -> list[str]:
    """Return pages from *all_pages* whose degree is <= 1."""
    degrees = compute_degrees(edges_path)
    return [p for p in all_pages if degrees.get(p, 0) <= 1]


# ── Path finding (NetworkX) ─────────────────────────────────────────


def _build_graph(edges_path: str) -> tuple[nx.DiGraph, dict]:
    """Build a NetworkX DiGraph from edges.jsonl.

    Returns (graph, edge_data_map) where edge_data_map maps
    (from, to) -> edge dict for reconstructing path output.
    """
    edges = _read_all_edges(edges_path)
    G = nx.DiGraph()
    edge_map: dict[tuple[str, str], dict] = {}
    for e in edges:
        src, tgt = e["from"], e["to"]
        G.add_edge(src, tgt)
        edge_map[(src, tgt)] = e
    return G, edge_map


def _nodes_to_edge_list(
    node_path: list[str], edge_map: dict[tuple[str, str], dict]
) -> list[dict]:
    """Convert a list of nodes to a list of edge dicts."""
    result = []
    for i in range(len(node_path) - 1):
        key = (node_path[i], node_path[i + 1])
        result.append(edge_map.get(key, {"from": key[0], "to": key[1]}))
    return result


def shortest_path(
    edges_path: str,
    from_concept: str,
    to_concept: str,
    max_hops: int = 6,
    via: str = None,
) -> list[dict]:
    """Find the shortest directed path between two concepts.

    If *via* is specified, the path must pass through that concept.
    If *max_hops* is exceeded or no path exists, returns [].
    """
    G, edge_map = _build_graph(edges_path)

    if from_concept not in G or to_concept not in G:
        return []

    if via is not None:
        # Path must go through 'via': find A->via then via->B
        try:
            path_a = nx.shortest_path(G, from_concept, via)
            path_b = nx.shortest_path(G, via, to_concept)
        except nx.NetworkXNoPath:
            return []
        # Merge: path_a ends with 'via', path_b starts with 'via'
        full_path = path_a + path_b[1:]
        num_edges = len(full_path) - 1
        if num_edges > max_hops:
            return []
        return _nodes_to_edge_list(full_path, edge_map)

    try:
        node_path = nx.shortest_path(G, from_concept, to_concept)
    except nx.NetworkXNoPath:
        return []

    num_edges = len(node_path) - 1
    if num_edges > max_hops:
        return []

    return _nodes_to_edge_list(node_path, edge_map)


def all_paths(
    edges_path: str,
    from_concept: str,
    to_concept: str,
    max_paths: int = 5,
) -> list[list[dict]]:
    """Return up to *max_paths* simple directed paths between two concepts."""
    G, edge_map = _build_graph(edges_path)

    if from_concept not in G or to_concept not in G:
        return []

    result = []
    for node_path in nx.all_simple_paths(G, from_concept, to_concept):
        result.append(_nodes_to_edge_list(node_path, edge_map))
        if len(result) >= max_paths:
            break
    return result


# ── CLI ─────────────────────────────────────────────────────────────


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Knowledge-graph edge operations.")
    sub = parser.add_subparsers(dest="command")

    # add
    add_p = sub.add_parser("add", help="Add an edge")
    add_p.add_argument("--edges", required=True)
    add_p.add_argument("--from", dest="from_page", required=True)
    add_p.add_argument("--to", dest="to_page", required=True)
    add_p.add_argument("--type", dest="edge_type", required=True)
    add_p.add_argument("--provenance", required=True)
    add_p.add_argument("--evidence", default="")
    add_p.add_argument("--source-file", default="")

    # path
    path_p = sub.add_parser("path", help="Find shortest path")
    path_p.add_argument("--edges", required=True)
    path_p.add_argument("--from", dest="from_concept", required=True)
    path_p.add_argument("--to", dest="to_concept", required=True)
    path_p.add_argument("--max-hops", type=int, default=6)
    path_p.add_argument("--via", default=None)

    # degrees
    deg_p = sub.add_parser("degrees", help="Compute node degrees")
    deg_p.add_argument("--edges", required=True)

    # god-nodes
    god_p = sub.add_parser("god-nodes", help="Top-N highest-degree nodes")
    god_p.add_argument("--edges", required=True)
    god_p.add_argument("--top", type=int, default=10)

    return parser


def main(argv: list[str] = None) -> None:
    parser = _build_parser()
    args = parser.parse_args(argv)

    if args.command == "add":
        edge = add_edge(
            args.edges,
            args.from_page,
            args.to_page,
            args.edge_type,
            args.provenance,
            evidence=args.evidence,
            source_file=args.source_file,
        )
        print(json.dumps(edge, indent=2))
    elif args.command == "path":
        result = shortest_path(
            args.edges, args.from_concept, args.to_concept,
            max_hops=args.max_hops, via=args.via,
        )
        print(json.dumps(result, indent=2))
    elif args.command == "degrees":
        result = compute_degrees(args.edges)
        print(json.dumps(result, indent=2))
    elif args.command == "god-nodes":
        result = god_nodes(args.edges, top_n=args.top)
        print(json.dumps(result, indent=2))
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
