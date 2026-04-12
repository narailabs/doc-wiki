"""Tests for mermaid_gen.py — written BEFORE implementation (TDD)."""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from mermaid_gen import (
    format_mermaid_block,
    inject_mermaid,
    extract_mermaid_from_output,
    validate_mermaid_type,
)

# ── Fixtures ────────────────────────────────────────────────────────


@pytest.fixture
def er_diagram_data():
    """An erDiagram mermaid data dict."""
    return {
        "type": "erDiagram",
        "title": "User Orders",
        "code": "    users ||--o{ orders : has\n    orders ||--|{ items : contains",
    }


@pytest.fixture
def sequence_diagram_data():
    """A sequenceDiagram mermaid data dict."""
    return {
        "type": "sequenceDiagram",
        "title": "Login Flow",
        "code": "    Client->>Server: Login\n    Server-->>Client: Token",
    }


@pytest.fixture
def graph_data():
    """A graph TD mermaid data dict."""
    return {
        "type": "graph TD",
        "title": "Service Dependencies",
        "code": "    A --> B\n    B --> C\n    A --> C",
    }


@pytest.fixture
def agent_output_with_mermaid():
    """Agent JSON output containing mermaid entries."""
    return {
        "page": "wiki/db/schema.md",
        "content": "Database schema overview.",
        "mermaid": [
            {
                "type": "erDiagram",
                "title": "Schema",
                "code": "    users ||--o{ orders : has",
            },
            {
                "type": "classDiagram",
                "title": "Models",
                "code": "    class User\n    User : +String name",
            },
        ],
    }


@pytest.fixture
def agent_output_no_mermaid():
    """Agent JSON output with no mermaid field."""
    return {
        "page": "wiki/auth/session.md",
        "content": "Session management details.",
    }


@pytest.fixture
def wiki_page_content():
    """A wiki page with existing content."""
    return (
        "---\ntitle: Schema\n---\n\n"
        "# Database Schema\n\n"
        "The database has users and orders tables.\n"
    )


@pytest.fixture
def wiki_page_with_diagrams():
    """A wiki page that already has a Diagrams section."""
    return (
        "---\ntitle: Schema\n---\n\n"
        "# Database Schema\n\n"
        "Some text.\n\n"
        "## Diagrams\n\n"
        "```mermaid\nerDiagram\n    old ||--o{ stuff : had\n```\n\n"
        "## Notes\n\n"
        "Keep this section.\n"
    )


# ── format_mermaid_block tests ────────────────────────────────────


class TestFormatMermaidBlock:
    def test_format_er_diagram(self, er_diagram_data):
        """erDiagram produces a valid fenced mermaid block."""
        result = format_mermaid_block(er_diagram_data)
        assert "```mermaid" in result
        assert "erDiagram" in result
        assert result.strip().endswith("```")
        assert "users ||--o{ orders : has" in result

    def test_format_sequence_diagram(self, sequence_diagram_data):
        """sequenceDiagram produces a valid fenced block."""
        result = format_mermaid_block(sequence_diagram_data)
        assert "```mermaid" in result
        assert "sequenceDiagram" in result
        assert "Client->>Server: Login" in result
        assert result.strip().endswith("```")

    def test_format_graph(self, graph_data):
        """graph TD produces a valid fenced block."""
        result = format_mermaid_block(graph_data)
        assert "```mermaid" in result
        assert "graph TD" in result
        assert "A --> B" in result

    def test_format_with_title(self, er_diagram_data):
        """Title appears as a comment above the mermaid block."""
        result = format_mermaid_block(er_diagram_data)
        # Title should appear before the code block as a comment
        lines = result.split("\n")
        # Find the title comment line
        title_lines = [l for l in lines if "User Orders" in l]
        assert len(title_lines) >= 1


# ── inject_mermaid tests ──────────────────────────────────────────


class TestInjectMermaid:
    def test_inject_into_empty_page(self):
        """Adds Diagrams section to an empty page."""
        block = "```mermaid\nerDiagram\n    A ||--o{ B : has\n```"
        result = inject_mermaid("", [block])
        assert "## Diagrams" in result
        assert "```mermaid" in result

    def test_inject_into_existing_page(self, wiki_page_content):
        """Appends to existing content without clobbering."""
        block = "```mermaid\nerDiagram\n    users ||--o{ orders : has\n```"
        result = inject_mermaid(wiki_page_content, [block])
        # Original content preserved
        assert "# Database Schema" in result
        assert "The database has users and orders tables." in result
        # Diagrams added
        assert "## Diagrams" in result
        assert "```mermaid" in result

    def test_inject_replaces_existing_diagrams_section(self, wiki_page_with_diagrams):
        """Replaces existing ## Diagrams section, preserves other sections."""
        new_block = "```mermaid\nerDiagram\n    new ||--o{ stuff : has\n```"
        result = inject_mermaid(wiki_page_with_diagrams, [new_block])
        # Old diagram gone
        assert "old ||--o{ stuff : had" not in result
        # New diagram present
        assert "new ||--o{ stuff : has" in result
        # Other sections preserved
        assert "## Notes" in result
        assert "Keep this section." in result


# ── extract_mermaid_from_output tests ─────────────────────────────


class TestExtractMermaidFromOutput:
    def test_extract_from_agent_output(self, agent_output_with_mermaid):
        """Extracts mermaid entries from agent JSON output."""
        result = extract_mermaid_from_output(agent_output_with_mermaid)
        assert len(result) == 2
        assert result[0]["type"] == "erDiagram"
        assert result[1]["type"] == "classDiagram"

    def test_extract_no_mermaid(self, agent_output_no_mermaid):
        """Returns empty list when no mermaid field."""
        result = extract_mermaid_from_output(agent_output_no_mermaid)
        assert result == []


# ── validate_mermaid_type tests ───────────────────────────────────


class TestValidateMermaidType:
    def test_validate_known_types(self):
        """All known diagram types return True."""
        known_types = [
            "erDiagram", "sequenceDiagram", "graph",
            "flowchart", "classDiagram",
        ]
        for t in known_types:
            assert validate_mermaid_type(t) is True, f"Expected True for {t}"

    def test_validate_unknown_type(self):
        """Unknown diagram type returns False."""
        assert validate_mermaid_type("unknownDiagram") is False
        assert validate_mermaid_type("") is False
        assert validate_mermaid_type("mermaid") is False


# ── CLI tests ─────────────────────────────────────────────────────

SCRIPT = str(Path(__file__).resolve().parent.parent / "mermaid_gen.py")


class TestMermaidGenCLI:
    def test_cli_input_json(self, tmp_path, agent_output_with_mermaid):
        """CLI --input reads JSON file and outputs formatted mermaid blocks."""
        input_file = tmp_path / "agent_output.json"
        input_file.write_text(json.dumps(agent_output_with_mermaid))

        result = subprocess.run(
            [sys.executable, SCRIPT, "--input", str(input_file)],
            capture_output=True, text=True,
        )
        assert result.returncode == 0
        assert "```mermaid" in result.stdout
        assert "erDiagram" in result.stdout

    def test_cli_page_injection(self, tmp_path, agent_output_with_mermaid):
        """CLI --input with --page injects mermaid into a wiki page."""
        input_file = tmp_path / "agent_output.json"
        input_file.write_text(json.dumps(agent_output_with_mermaid))

        page_file = tmp_path / "schema.md"
        page_file.write_text(
            "---\ntitle: Schema\n---\n\n# Schema\n\nSome content.\n"
        )

        result = subprocess.run(
            [sys.executable, SCRIPT, "--input", str(input_file),
             "--page", str(page_file)],
            capture_output=True, text=True,
        )
        assert result.returncode == 0
        updated = page_file.read_text()
        assert "```mermaid" in updated
        assert "# Schema" in updated
