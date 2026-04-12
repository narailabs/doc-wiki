"""Tests for claude_md_gen.py — written BEFORE implementation (TDD)."""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from claude_md_gen import (
    generate_claude_md,
    update_claude_md,
    extract_managed_section,
    list_submodules,
)

# ── Fixtures ────────────────────────────────────────────────────────


@pytest.fixture
def project_root(tmp_path):
    """Create a minimal project root with a wiki directory."""
    wiki_dir = tmp_path / "wiki"
    wiki_dir.mkdir()
    (wiki_dir / "index.md").write_text("# Wiki Index\n")
    return tmp_path


@pytest.fixture
def project_with_submodules(tmp_path):
    """Project root with two submodule directories that each have CLAUDE.md."""
    wiki_dir = tmp_path / "wiki"
    wiki_dir.mkdir()
    (wiki_dir / "index.md").write_text("# Wiki Index\n")

    for name in ("services/auth", "services/billing"):
        sub = tmp_path / name
        sub.mkdir(parents=True)
        (sub / "CLAUDE.md").write_text(f"# {name}\n\nCustom content.\n")

    return tmp_path


@pytest.fixture
def claude_md_with_markers(tmp_path):
    """A CLAUDE.md file with user sections and wiki-managed markers."""
    p = tmp_path / "CLAUDE.md"
    p.write_text(
        "# My Project\n\n"
        "Custom intro that should be preserved.\n\n"
        "<!-- wiki-managed: start -->\n"
        "## Overview\n\nOld generated overview.\n"
        "<!-- wiki-managed: end -->\n\n"
        "## My Custom Section\n\nThis is hand-written.\n"
    )
    return p


@pytest.fixture
def claude_md_without_markers(tmp_path):
    """A CLAUDE.md file with no wiki-managed markers."""
    p = tmp_path / "CLAUDE.md"
    p.write_text(
        "# My Project\n\n"
        "All custom content, no managed sections.\n"
    )
    return p


# ── generate_claude_md tests ──────────────────────────────────────


class TestGenerateClaudeMd:
    def test_generate_basic(self, project_root):
        """Generates markdown string containing managed markers."""
        result = generate_claude_md(str(project_root), str(project_root / "wiki"))
        assert "<!-- wiki-managed: start -->" in result
        assert "<!-- wiki-managed: end -->" in result

    def test_generate_with_wiki_link(self, project_root):
        """Generated content includes a link to the wiki root."""
        result = generate_claude_md(str(project_root), str(project_root / "wiki"))
        assert "wiki" in result.lower()
        # Should contain a markdown link to the wiki
        assert "[" in result and "](" in result

    def test_generate_with_submodule(self, project_with_submodules):
        """Submodule generation includes link back to root CLAUDE.md."""
        result = generate_claude_md(
            str(project_with_submodules),
            str(project_with_submodules / "wiki"),
            submodule="services/auth",
        )
        assert "<!-- wiki-managed: start -->" in result
        # Should reference the root CLAUDE.md
        assert "CLAUDE.md" in result


# ── update_claude_md tests ──────────────────────────────────────


class TestUpdateClaudeMd:
    def test_update_preserves_user_sections(self, claude_md_with_markers):
        """Content outside markers remains untouched after update."""
        new_managed = "## Overview\n\nNew generated overview.\n"
        result = update_claude_md(str(claude_md_with_markers), new_managed)
        assert "Custom intro that should be preserved." in result
        assert "## My Custom Section" in result
        assert "This is hand-written." in result

    def test_update_replaces_managed_section(self, claude_md_with_markers):
        """Content between markers is replaced with new content."""
        new_managed = "## Overview\n\nBrand new overview content.\n"
        result = update_claude_md(str(claude_md_with_markers), new_managed)
        assert "Brand new overview content." in result
        assert "Old generated overview." not in result

    def test_idempotent_update(self, claude_md_with_markers):
        """Updating twice with the same content produces identical output."""
        new_managed = "## Overview\n\nStable content.\n"
        first = update_claude_md(str(claude_md_with_markers), new_managed)
        # Write first result back, then update again
        claude_md_with_markers.write_text(first)
        second = update_claude_md(str(claude_md_with_markers), new_managed)
        assert first == second

    def test_handles_missing_file(self, tmp_path):
        """When file doesn't exist, generates fresh content with markers."""
        missing = tmp_path / "nonexistent" / "CLAUDE.md"
        new_managed = "## Overview\n\nFresh content.\n"
        result = update_claude_md(str(missing), new_managed)
        assert "<!-- wiki-managed: start -->" in result
        assert "<!-- wiki-managed: end -->" in result
        assert "Fresh content." in result


# ── extract_managed_section tests ─────────────────────────────────


class TestExtractManagedSection:
    def test_extract_managed_section(self, claude_md_with_markers):
        """Extracts content between markers."""
        content = claude_md_with_markers.read_text()
        section = extract_managed_section(content)
        assert section is not None
        assert "Old generated overview." in section

    def test_extract_no_markers(self, claude_md_without_markers):
        """Returns None when content has no markers."""
        content = claude_md_without_markers.read_text()
        assert extract_managed_section(content) is None


# ── list_submodules tests ──────────────────────────────────────────


class TestListSubmodules:
    def test_list_submodules(self, project_with_submodules):
        """Finds directories that have their own CLAUDE.md files."""
        result = list_submodules(str(project_with_submodules))
        assert len(result) == 2
        names = sorted(result)
        assert "services/auth" in names
        assert "services/billing" in names

    def test_list_submodules_empty(self, project_root):
        """Returns empty list when no submodule CLAUDE.md files exist."""
        result = list_submodules(str(project_root))
        assert result == []


# ── CLI tests ─────────────────────────────────────────────────────

SCRIPT = str(Path(__file__).resolve().parent.parent / "claude_md_gen.py")


class TestClaudeMdGenCLI:
    def test_cli_project_root(self, project_root):
        """CLI --project-root generates output to stdout."""
        result = subprocess.run(
            [sys.executable, SCRIPT, "--project-root", str(project_root),
             "--wiki-root", str(project_root / "wiki")],
            capture_output=True, text=True,
        )
        assert result.returncode == 0
        assert "<!-- wiki-managed: start -->" in result.stdout

    def test_cli_update(self, claude_md_with_markers):
        """CLI --update replaces managed section in an existing file."""
        project_root = claude_md_with_markers.parent
        wiki_dir = project_root / "wiki"
        wiki_dir.mkdir(exist_ok=True)
        (wiki_dir / "index.md").write_text("# Wiki Index\n")

        result = subprocess.run(
            [sys.executable, SCRIPT, "--project-root", str(project_root),
             "--wiki-root", str(wiki_dir), "--update", str(claude_md_with_markers)],
            capture_output=True, text=True,
        )
        assert result.returncode == 0
        updated = claude_md_with_markers.read_text()
        assert "Custom intro that should be preserved." in updated
        assert "<!-- wiki-managed: start -->" in updated
