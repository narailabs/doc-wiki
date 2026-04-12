"""Tests for security_check.py -- written FIRST (TDD)."""
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

import pytest

# Allow importing from the scripts directory
SCRIPTS_DIR = str(Path(__file__).resolve().parent.parent)
sys.path.insert(0, SCRIPTS_DIR)


# ------------------------------------------------------------------
# URL validation tests
# ------------------------------------------------------------------

class TestValidateUrl:

    def test_valid_http_url(self):
        from security_check import validate_url
        assert validate_url("http://example.com") is True

    def test_valid_https_url(self):
        from security_check import validate_url
        assert validate_url("https://example.com") is True

    def test_block_file_url(self):
        from security_check import validate_url
        assert validate_url("file:///etc/passwd") is False

    def test_block_data_url(self):
        from security_check import validate_url
        assert validate_url("data:text/html,<h1>hi</h1>") is False

    def test_block_ftp_url(self):
        from security_check import validate_url
        assert validate_url("ftp://server/file") is False

    def test_empty_url_fails(self):
        from security_check import validate_url
        assert validate_url("") is False


# ------------------------------------------------------------------
# Path containment tests
# ------------------------------------------------------------------

class TestCheckPathContainment:

    def test_path_inside_wiki_root_passes(self, tmp_path):
        """A path under wiki root passes containment."""
        from security_check import check_path_containment

        wiki_root = tmp_path / "wiki-root"
        wiki_root.mkdir()
        page = wiki_root / "wiki" / "page.md"
        page.parent.mkdir(parents=True, exist_ok=True)
        page.touch()
        assert check_path_containment(str(page), str(wiki_root)) is True

    def test_path_outside_wiki_root_fails(self, tmp_path):
        """A path that escapes wiki root via .. is rejected."""
        from security_check import check_path_containment

        wiki_root = tmp_path / "wiki-root"
        wiki_root.mkdir()
        evil_path = str(wiki_root / ".." / ".." / "etc" / "passwd")
        assert check_path_containment(evil_path, str(wiki_root)) is False

    def test_symlink_traversal_fails(self, tmp_path):
        """A symlink resolving outside wiki root is rejected."""
        from security_check import check_path_containment

        wiki_root = tmp_path / "wiki-root"
        wiki_root.mkdir()
        outside = tmp_path / "outside"
        outside.mkdir()
        secret = outside / "secret.txt"
        secret.write_text("secret")

        link = wiki_root / "sneaky_link"
        link.symlink_to(secret)

        assert check_path_containment(str(link), str(wiki_root)) is False


# ------------------------------------------------------------------
# Label sanitization tests
# ------------------------------------------------------------------

class TestSanitizeLabel:

    def test_label_sanitization_strips_control_chars(self):
        from security_check import sanitize_label
        result = sanitize_label("hello\x00\x01world")
        assert "\x00" not in result
        assert "\x01" not in result
        assert "helloworld" in result

    def test_label_sanitization_caps_length(self):
        from security_check import sanitize_label
        long_label = "a" * 500
        result = sanitize_label(long_label)
        assert len(result) <= 256

    def test_label_sanitization_html_escapes(self):
        from security_check import sanitize_label
        result = sanitize_label("<script>alert(1)</script>")
        assert "<script>" not in result
        assert "&lt;script&gt;" in result


# ------------------------------------------------------------------
# CLI interface tests
# ------------------------------------------------------------------

class TestSecurityCheckCLI:

    def test_cli_url_valid(self):
        result = subprocess.run(
            [sys.executable, str(Path(SCRIPTS_DIR) / "security_check.py"),
             "--url", "https://example.com"],
            capture_output=True, text=True,
        )
        assert result.returncode == 0

    def test_cli_url_invalid(self):
        result = subprocess.run(
            [sys.executable, str(Path(SCRIPTS_DIR) / "security_check.py"),
             "--url", "file:///etc/passwd"],
            capture_output=True, text=True,
        )
        assert result.returncode == 1
        body = json.loads(result.stdout)
        assert "error" in body

    def test_cli_path_containment(self, tmp_path):
        wiki_root = tmp_path / "wiki-root"
        wiki_root.mkdir()
        page = wiki_root / "page.md"
        page.touch()
        result = subprocess.run(
            [sys.executable, str(Path(SCRIPTS_DIR) / "security_check.py"),
             "--path", str(page), "--wiki-root", str(wiki_root)],
            capture_output=True, text=True,
        )
        assert result.returncode == 0

    def test_cli_label(self):
        result = subprocess.run(
            [sys.executable, str(Path(SCRIPTS_DIR) / "security_check.py"),
             "--label", "<b>bold</b>"],
            capture_output=True, text=True,
        )
        assert result.returncode == 0
        body = json.loads(result.stdout)
        assert "&lt;b&gt;" in body["sanitized"]
