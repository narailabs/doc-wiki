"""Tests for graph_ops.py — written BEFORE implementation (TDD)."""
import json
import sys
from pathlib import Path

import pytest

# Ensure the scripts package is importable
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from graph_ops import (
    add_edge,
    remove_edge,
    list_edges,
    compute_degrees,
    god_nodes,
    isolated_nodes,
    shortest_path,
    all_paths,
)

# ── Fixtures ────────────────────────────────────────────────────────


@pytest.fixture
def edges_file(tmp_path):
    """Return path to a fresh, empty edges.jsonl."""
    p = tmp_path / "edges.jsonl"
    p.touch()
    return str(p)


@pytest.fixture
def populated_edges(edges_file):
    """edges.jsonl pre-populated with a small graph for path tests.

    Graph topology (all 'extends' edges, provenance EXTRACTED):
        A -> B -> C -> D
        A -> E -> D
        E -> F
    """
    edges = [
        {"from": "A", "to": "B", "type": "extends", "provenance": "EXTRACTED",
         "evidence": "", "source_file": "", "date": "2026-04-10"},
        {"from": "B", "to": "C", "type": "extends", "provenance": "EXTRACTED",
         "evidence": "", "source_file": "", "date": "2026-04-10"},
        {"from": "C", "to": "D", "type": "extends", "provenance": "EXTRACTED",
         "evidence": "", "source_file": "", "date": "2026-04-10"},
        {"from": "A", "to": "E", "type": "supports", "provenance": "INFERRED",
         "evidence": "", "source_file": "", "date": "2026-04-10"},
        {"from": "E", "to": "D", "type": "extends", "provenance": "EXTRACTED",
         "evidence": "", "source_file": "", "date": "2026-04-10"},
        {"from": "E", "to": "F", "type": "contradicts", "provenance": "AMBIGUOUS",
         "evidence": "", "source_file": "", "date": "2026-04-10"},
    ]
    with open(edges_file, "w") as f:
        for e in edges:
            f.write(json.dumps(e) + "\n")
    return edges_file


# ── Edge CRUD tests ─────────────────────────────────────────────────


class TestAddEdge:
    def test_add_edge(self, edges_file):
        """add_edge writes a typed edge to edges.jsonl."""
        result = add_edge(
            edges_file,
            from_page="wiki/auth/session.md",
            to_page="wiki/auth/jwt.md",
            edge_type="extends",
            provenance="EXTRACTED",
        )
        assert result["from"] == "wiki/auth/session.md"
        assert result["to"] == "wiki/auth/jwt.md"
        assert result["type"] == "extends"

        lines = Path(edges_file).read_text().strip().splitlines()
        assert len(lines) == 1
        stored = json.loads(lines[0])
        assert stored["type"] == "extends"

    def test_add_edge_with_provenance(self, edges_file):
        """Edge includes provenance field (EXTRACTED/INFERRED/AMBIGUOUS)."""
        for prov in ("EXTRACTED", "INFERRED", "AMBIGUOUS"):
            result = add_edge(edges_file, "A", "B", "supports", prov,
                              evidence=f"test {prov}")
            assert result["provenance"] == prov

    def test_add_edge_requires_provenance(self, edges_file):
        """Missing or invalid provenance raises ValueError."""
        with pytest.raises(ValueError):
            add_edge(edges_file, "A", "B", "extends", "WRONG")

    def test_edge_types_validated(self, edges_file):
        """Invalid edge type raises ValueError."""
        with pytest.raises(ValueError):
            add_edge(edges_file, "A", "B", "depends_on", "EXTRACTED")


class TestRemoveEdge:
    def test_remove_edge(self, edges_file):
        """remove_edge removes the matching edge and returns True."""
        add_edge(edges_file, "A", "B", "extends", "EXTRACTED")
        add_edge(edges_file, "B", "C", "supports", "INFERRED")

        removed = remove_edge(edges_file, "A", "B", "extends")
        assert removed is True

        remaining = list_edges(edges_file)
        assert len(remaining) == 1
        assert remaining[0]["from"] == "B"


class TestListEdges:
    def test_list_edges(self, populated_edges):
        """list_edges returns all edges as list of dicts."""
        edges = list_edges(populated_edges)
        assert isinstance(edges, list)
        assert len(edges) == 6
        assert all(isinstance(e, dict) for e in edges)

    def test_query_edges_by_type(self, populated_edges):
        """Filter edges by type."""
        extends = list_edges(populated_edges, edge_type="extends")
        assert len(extends) == 4
        assert all(e["type"] == "extends" for e in extends)

        contradicts = list_edges(populated_edges, edge_type="contradicts")
        assert len(contradicts) == 1


# ── Degree / topology tests ─────────────────────────────────────────


class TestDegrees:
    def test_degree_computation(self, populated_edges):
        """compute_degrees returns degree (in + out) for each node."""
        degrees = compute_degrees(populated_edges)
        # A: out to B, out to E => degree 2
        assert degrees["A"] == 2
        # B: in from A, out to C => degree 2
        assert degrees["B"] == 2
        # E: in from A, out to D, out to F => degree 3
        assert degrees["E"] == 3
        # D: in from C, in from E => degree 2
        assert degrees["D"] == 2

    def test_god_nodes(self, populated_edges):
        """Return top-N highest-degree nodes, excluding Index/Summary types."""
        top = god_nodes(populated_edges, top_n=2)
        assert isinstance(top, list)
        assert len(top) == 2
        # Each entry is (node, degree)
        assert top[0][0] == "E"  # degree 3
        assert top[0][1] == 3

    def test_isolated_nodes(self, populated_edges):
        """Return nodes from all_pages with degree <= 1."""
        all_pages = ["A", "B", "C", "D", "E", "F", "G", "H"]
        iso = isolated_nodes(populated_edges, all_pages)
        # G and H have degree 0; F has degree 1 (only one edge: E->F)
        assert "G" in iso
        assert "H" in iso
        assert "F" in iso
        # A, B, C, D, E should NOT be isolated
        assert "A" not in iso
        assert "E" not in iso


# ── Path-finding tests ──────────────────────────────────────────────


class TestShortestPath:
    def test_shortest_path(self, populated_edges):
        """Find a shortest path between two concepts."""
        path = shortest_path(populated_edges, "A", "D")
        assert len(path) >= 1
        # The shortest path A->E->D has 2 edges
        nodes_in_path = [path[0]["from"]] + [e["to"] for e in path]
        assert nodes_in_path[0] == "A"
        assert nodes_in_path[-1] == "D"
        assert len(path) == 2  # A->E->D

    def test_shortest_path_with_max_hops(self, populated_edges):
        """Respects max_hops limit."""
        # A->D requires at least 2 hops, so max_hops=1 should fail
        path = shortest_path(populated_edges, "A", "D", max_hops=1)
        assert path == []

    def test_shortest_path_via_concept(self, populated_edges):
        """Path must pass through a named concept."""
        # Force path through B: A->B->C->D (length 3)
        path = shortest_path(populated_edges, "A", "D", via="B")
        nodes = [path[0]["from"]] + [e["to"] for e in path]
        assert "B" in nodes
        assert nodes[0] == "A"
        assert nodes[-1] == "D"

    def test_shortest_path_not_found(self, populated_edges):
        """Returns empty list when no path exists."""
        path = shortest_path(populated_edges, "F", "A")
        # F has no outgoing edges to reach A in directed graph
        assert path == []

    def test_all_paths(self, populated_edges):
        """Returns multiple paths between two nodes."""
        paths = all_paths(populated_edges, "A", "D", max_paths=5)
        assert isinstance(paths, list)
        # Should find at least 2 paths: A->B->C->D and A->E->D
        assert len(paths) >= 2
        for p in paths:
            nodes = [p[0]["from"]] + [e["to"] for e in p]
            assert nodes[0] == "A"
            assert nodes[-1] == "D"
