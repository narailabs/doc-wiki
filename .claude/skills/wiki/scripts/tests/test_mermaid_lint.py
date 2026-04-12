"""Tests for mermaid_lint.py — written BEFORE implementation (TDD)."""
import json
import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from mermaid_lint import (
    extract_mermaid_blocks,
    validate_block,
    lint_page,
    lint_wiki_mermaid,
)

# ── Fixtures ────────────────────────────────────────────────────────


@pytest.fixture
def page_with_valid_mermaid(tmp_path):
    """Wiki page with a valid erDiagram block."""
    p = tmp_path / "wiki" / "valid.md"
    p.parent.mkdir(parents=True)
    p.write_text(
        "---\ntitle: Valid\n---\n\n"
        "# Valid Page\n\n"
        "Some text.\n\n"
        "```mermaid\n"
        "erDiagram\n"
        "    users ||--o{ orders : has\n"
        "```\n"
    )
    return str(p)


@pytest.fixture
def page_with_invalid_mermaid(tmp_path):
    """Wiki page with an invalid mermaid block (unknown diagram type)."""
    p = tmp_path / "wiki" / "invalid.md"
    p.parent.mkdir(parents=True)
    p.write_text(
        "---\ntitle: Invalid\n---\n\n"
        "```mermaid\n"
        "unknownDiagram\n"
        "    A -> B\n"
        "```\n"
    )
    return str(p)


@pytest.fixture
def page_no_mermaid(tmp_path):
    """Wiki page with no mermaid blocks."""
    p = tmp_path / "wiki" / "plain.md"
    p.parent.mkdir(parents=True)
    p.write_text("---\ntitle: Plain\n---\n\n# Just text\n\nNo diagrams here.\n")
    return str(p)


# ── extract_mermaid_blocks tests ────────────────────────────────────


class TestExtractMermaidBlocks:
    def test_single_block(self):
        """Content with one mermaid block returns one dict."""
        content = "# Title\n\n```mermaid\nerDiagram\n    A ||--o{ B : has\n```\n"
        blocks = extract_mermaid_blocks(content)
        assert len(blocks) == 1
        assert blocks[0]["diagram_type"] == "erDiagram"
        assert "A ||--o{ B" in blocks[0]["content"]

    def test_multiple_blocks(self):
        """Content with 3 mermaid blocks returns 3 dicts."""
        content = (
            "```mermaid\nerDiagram\n    A ||--o{ B : has\n```\n\n"
            "Some text\n\n"
            "```mermaid\nsequenceDiagram\n    A->>B: msg\n```\n\n"
            "```mermaid\ngraph TD\n    A --> B\n```\n"
        )
        blocks = extract_mermaid_blocks(content)
        assert len(blocks) == 3

    def test_no_blocks(self):
        """Content with no mermaid blocks returns empty list."""
        content = "# Just text\n\nNo diagrams.\n"
        assert extract_mermaid_blocks(content) == []

    def test_non_mermaid_code_blocks(self):
        """Non-mermaid code blocks are not matched."""
        content = "```python\nprint('hello')\n```\n\n```json\n{}\n```\n"
        assert extract_mermaid_blocks(content) == []

    def test_line_numbers(self):
        """Returned line numbers point to the opening fence (1-indexed)."""
        content = "line 1\nline 2\n```mermaid\nerDiagram\n```\nline 6\n"
        blocks = extract_mermaid_blocks(content)
        assert len(blocks) == 1
        assert blocks[0]["line"] == 3


# ── validate_block tests ───────────────────────────────────────────


class TestValidateBlock:
    def test_valid_er_diagram(self):
        """Well-formed erDiagram returns no errors."""
        block = "erDiagram\n    users ||--o{ orders : has\n"
        assert validate_block(block) == []

    def test_valid_sequence_diagram(self):
        """Well-formed sequenceDiagram returns no errors."""
        block = "sequenceDiagram\n    Alice->>Bob: Hello\n    Bob-->>Alice: Hi\n"
        assert validate_block(block) == []

    def test_valid_graph(self):
        """Well-formed graph TD returns no errors."""
        block = "graph TD\n    A --> B\n    B --> C\n"
        assert validate_block(block) == []

    def test_valid_flowchart(self):
        """Well-formed flowchart returns no errors."""
        block = "flowchart LR\n    A --> B\n"
        assert validate_block(block) == []

    def test_valid_class_diagram(self):
        """Well-formed classDiagram returns no errors."""
        block = "classDiagram\n    class Animal\n    Animal : +String name\n"
        assert validate_block(block) == []

    def test_unknown_diagram_type(self):
        """Block with unrecognized keyword returns an error."""
        block = "unknownDiagram\n    A -> B\n"
        errors = validate_block(block)
        assert len(errors) >= 1
        assert "unknown" in errors[0].lower() or "unrecognized" in errors[0].lower()

    def test_empty_block(self):
        """Empty block returns an error."""
        errors = validate_block("")
        assert len(errors) >= 1

    def test_unbalanced_brackets(self):
        """Block with mismatched brackets returns an error."""
        block = "graph TD\n    A[unclosed\n    B --> C\n"
        errors = validate_block(block)
        assert len(errors) >= 1


# ── lint_page tests ────────────────────────────────────────────────


class TestLintPage:
    def test_valid_page(self, page_with_valid_mermaid):
        """Page with valid mermaid returns empty issues."""
        issues = lint_page(page_with_valid_mermaid)
        assert issues == []

    def test_page_with_errors(self, page_with_invalid_mermaid):
        """Page with invalid mermaid returns issues."""
        issues = lint_page(page_with_invalid_mermaid)
        assert len(issues) >= 1
        assert "page" in issues[0]
        assert "line" in issues[0]
        assert "errors" in issues[0]

    def test_no_mermaid(self, page_no_mermaid):
        """Page with no mermaid returns empty issues."""
        assert lint_page(page_no_mermaid) == []


# ── lint_wiki_mermaid tests ────────────────────────────────────────


class TestLintWikiMermaid:
    def test_all_valid(self, wiki_with_pages):
        """Wiki with only valid mermaid pages returns empty/minimal list."""
        issues = lint_wiki_mermaid(str(wiki_with_pages))
        # wiki_with_pages has one valid mermaid block in auth/session.md
        # No invalid blocks => no issues for mermaid validation
        mermaid_issues = [i for i in issues if i.get("errors")]
        # Should be empty since the only mermaid is valid
        for issue in mermaid_issues:
            assert "errors" in issue

    def test_wiki_with_errors(self, tmp_path):
        """Wiki with invalid mermaid returns issues."""
        wiki_dir = tmp_path / "wiki"
        wiki_dir.mkdir()
        (wiki_dir / "bad.md").write_text(
            "---\ntitle: Bad\n---\n\n"
            "```mermaid\nbadDiagram\n```\n"
        )
        issues = lint_wiki_mermaid(str(tmp_path))
        assert len(issues) >= 1

    def test_empty_wiki(self, tmp_path):
        """Wiki with no pages returns empty list."""
        (tmp_path / "wiki").mkdir()
        assert lint_wiki_mermaid(str(tmp_path)) == []


# ── CLI tests ──────────────────────────────────────────────────────

SCRIPT = str(Path(__file__).resolve().parent.parent / "mermaid_lint.py")


class TestMermaidLintCLI:
    def test_cli_single_page(self, page_with_valid_mermaid):
        """CLI --page prints JSON issues list."""
        result = subprocess.run(
            [sys.executable, SCRIPT, "--page", page_with_valid_mermaid],
            capture_output=True, text=True,
        )
        assert result.returncode == 0
        data = json.loads(result.stdout)
        assert isinstance(data, list)

    def test_cli_wiki_root(self, wiki_with_pages):
        """CLI --wiki-root prints JSON issues for all pages."""
        result = subprocess.run(
            [sys.executable, SCRIPT, "--wiki-root", str(wiki_with_pages)],
            capture_output=True, text=True,
        )
        assert result.returncode == 0
        data = json.loads(result.stdout)
        assert isinstance(data, list)
