"""Tests for cache_manager.py — written BEFORE implementation (TDD)."""
import hashlib
import json
import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from cache_manager import (
    compute_hash,
    check_cache,
    store_cache,
    clear_cache,
    get_cache_version,
    set_cache_version,
)

# ── Fixtures ────────────────────────────────────────────────────────


@pytest.fixture
def cache_wiki(initialized_wiki):
    """Initialized wiki with a known cache version."""
    set_cache_version(str(initialized_wiki), "1")
    return initialized_wiki


# ── compute_hash tests ──────────────────────────────────────────────


class TestComputeHash:
    def test_deterministic(self):
        """Same input produces same SHA256 hex digest."""
        h1 = compute_hash("hello world")
        h2 = compute_hash("hello world")
        assert h1 == h2
        assert h1 == hashlib.sha256(b"hello world").hexdigest()

    def test_different_inputs(self):
        """Different inputs produce different hashes."""
        assert compute_hash("alpha") != compute_hash("beta")

    def test_body_only_strips_frontmatter(self):
        """body_only=True strips YAML frontmatter before hashing."""
        content = "---\ntitle: Test\ntype: concept\n---\nBody text here"
        body_hash = compute_hash(content, body_only=True)
        plain_hash = compute_hash("Body text here")
        assert body_hash == plain_hash

    def test_body_only_no_frontmatter(self):
        """Content without frontmatter is hashed as-is even with body_only=True."""
        content = "Just plain text, no frontmatter"
        assert compute_hash(content, body_only=True) == compute_hash(content)

    def test_empty_string(self):
        """Empty string produces a valid 64-char hex digest."""
        h = compute_hash("")
        assert len(h) == 64
        assert all(c in "0123456789abcdef" for c in h)


# ── check_cache tests ──────────────────────────────────────────────


class TestCheckCache:
    def test_miss(self, cache_wiki):
        """Returns None when no cache entry exists."""
        result = check_cache(str(cache_wiki), "nonexistenthash")
        assert result is None

    def test_hit_after_store(self, cache_wiki):
        """After store_cache, check_cache returns the stored metadata."""
        wiki = str(cache_wiki)
        meta = {"source": "test.md", "pages_created": 2}
        h = compute_hash("some content")
        store_cache(wiki, h, meta)
        result = check_cache(wiki, h)
        assert result is not None
        assert result["source"] == "test.md"
        assert result["pages_created"] == 2

    def test_no_cache_dir(self, tmp_path):
        """Returns None gracefully when .wiki-cache/ does not exist."""
        result = check_cache(str(tmp_path), "anyhash")
        assert result is None

    def test_corrupted_file(self, cache_wiki):
        """Returns None when the cache JSON file is malformed."""
        wiki = str(cache_wiki)
        h = "abc123"
        cache_file = Path(wiki) / ".wiki-cache" / f"{h}.json"
        cache_file.write_text("not valid json{{{")
        result = check_cache(wiki, h)
        assert result is None


# ── store_cache tests ──────────────────────────────────────────────


class TestStoreCache:
    def test_creates_file(self, cache_wiki):
        """Writes .wiki-cache/<hash>.json containing the metadata."""
        wiki = str(cache_wiki)
        h = compute_hash("test content")
        store_cache(wiki, h, {"source": "file.md"})
        cache_file = Path(wiki) / ".wiki-cache" / f"{h}.json"
        assert cache_file.exists()
        data = json.loads(cache_file.read_text())
        assert data["source"] == "file.md"

    def test_overwrites_existing(self, cache_wiki):
        """Storing with the same hash overwrites the previous entry."""
        wiki = str(cache_wiki)
        h = compute_hash("test")
        store_cache(wiki, h, {"version": 1})
        store_cache(wiki, h, {"version": 2})
        result = check_cache(wiki, h)
        assert result["version"] == 2

    def test_creates_cache_dir(self, tmp_path):
        """If .wiki-cache/ does not exist, creates it before writing."""
        wiki = str(tmp_path / "new-wiki")
        Path(wiki).mkdir()
        h = compute_hash("data")
        set_cache_version(wiki, "1")
        store_cache(wiki, h, {"key": "val"})
        assert (Path(wiki) / ".wiki-cache" / f"{h}.json").exists()


# ── clear_cache tests ──────────────────────────────────────────────


class TestClearCache:
    def test_removes_entries(self, cache_wiki):
        """After storing 3 entries, clear removes all and returns count 3."""
        wiki = str(cache_wiki)
        for i in range(3):
            store_cache(wiki, compute_hash(f"content{i}"), {"i": i})
        count = clear_cache(wiki)
        assert count == 3

    def test_empty(self, cache_wiki):
        """Returns 0 when cache dir is empty."""
        count = clear_cache(str(cache_wiki))
        assert count == 0

    def test_preserves_version_file(self, cache_wiki):
        """VERSION file is NOT removed by clear."""
        wiki = str(cache_wiki)
        store_cache(wiki, compute_hash("x"), {"x": 1})
        clear_cache(wiki)
        assert (Path(wiki) / ".wiki-cache" / "VERSION").exists()


# ── cache version tests ────────────────────────────────────────────


class TestCacheVersion:
    def test_set_and_get(self, initialized_wiki):
        """set_cache_version writes, get_cache_version reads back."""
        wiki = str(initialized_wiki)
        set_cache_version(wiki, "42")
        assert get_cache_version(wiki) == "42"

    def test_get_version_missing(self, tmp_path):
        """Returns '0' when no VERSION file exists."""
        assert get_cache_version(str(tmp_path)) == "0"

    def test_version_mismatch_invalidates(self, cache_wiki):
        """Cache entries with wrong version are treated as misses."""
        wiki = str(cache_wiki)
        h = compute_hash("content")
        store_cache(wiki, h, {"data": "old"})
        # Change the version
        set_cache_version(wiki, "99")
        # Old entry should now be a miss
        assert check_cache(wiki, h) is None


# ── CLI tests ──────────────────────────────────────────────────────

SCRIPT = str(Path(__file__).resolve().parent.parent / "cache_manager.py")


class TestCacheManagerCLI:
    def test_cli_check_miss(self, cache_wiki):
        """CLI check returns hit=false for unknown content."""
        result = subprocess.run(
            [sys.executable, SCRIPT, "check",
             "--wiki-root", str(cache_wiki), "--content", "unknown"],
            capture_output=True, text=True,
        )
        assert result.returncode == 0
        data = json.loads(result.stdout)
        assert data["hit"] is False

    def test_cli_store_and_check(self, cache_wiki):
        """CLI store then check produces a hit."""
        wiki = str(cache_wiki)
        # Store
        subprocess.run(
            [sys.executable, SCRIPT, "store",
             "--wiki-root", wiki, "--content", "hello",
             "--metadata", '{"source": "test.md"}'],
            capture_output=True, text=True,
        )
        # Check
        result = subprocess.run(
            [sys.executable, SCRIPT, "check",
             "--wiki-root", wiki, "--content", "hello"],
            capture_output=True, text=True,
        )
        assert result.returncode == 0
        data = json.loads(result.stdout)
        assert data["hit"] is True

    def test_cli_clear(self, cache_wiki):
        """CLI clear reports count of removed entries."""
        wiki = str(cache_wiki)
        store_cache(wiki, compute_hash("a"), {"a": 1})
        store_cache(wiki, compute_hash("b"), {"b": 2})
        result = subprocess.run(
            [sys.executable, SCRIPT, "clear", "--wiki-root", wiki],
            capture_output=True, text=True,
        )
        assert result.returncode == 0
        data = json.loads(result.stdout)
        assert data["removed"] == 2
