"""Tests for parse_config.py — written FIRST (TDD)."""
import json
import subprocess
import sys
import tempfile
from pathlib import Path

import pytest
import yaml

# Allow importing from the scripts directory
SCRIPTS_DIR = str(Path(__file__).resolve().parent.parent)
sys.path.insert(0, SCRIPTS_DIR)


@pytest.fixture
def valid_config_yaml(tmp_path):
    """Write a valid wiki.config.yaml and return its path."""
    config = {
        "wiki": {
            "name": "My Docs",
            "domain": "engineering",
            "max_depth": 4,
        },
        "autonomy": {"mode": "balanced"},
        "sources": {"providers": {"file": {"type": "static"}}},
    }
    p = tmp_path / "wiki.config.yaml"
    p.write_text(yaml.dump(config))
    return p


@pytest.fixture
def minimal_config_yaml(tmp_path):
    """Config with only the required field (wiki.name)."""
    config = {"wiki": {"name": "Minimal Wiki"}}
    p = tmp_path / "wiki.config.yaml"
    p.write_text(yaml.dump(config))
    return p


# ------------------------------------------------------------------
# Tests
# ------------------------------------------------------------------

class TestParseConfig:

    def test_parse_valid_config(self, valid_config_yaml):
        """Parses a valid wiki.config.yaml and returns a JSON-serialisable dict."""
        from parse_config import parse_config

        result = parse_config(str(valid_config_yaml))
        assert isinstance(result, dict)
        assert result["wiki"]["name"] == "My Docs"
        assert result["wiki"]["domain"] == "engineering"
        assert result["wiki"]["max_depth"] == 4
        assert result["autonomy"]["mode"] == "balanced"

    def test_default_values(self, minimal_config_yaml):
        """Missing optional fields get sensible defaults."""
        from parse_config import parse_config

        result = parse_config(str(minimal_config_yaml))
        assert result["wiki"]["max_depth"] == 3, "max_depth should default to 3"
        assert result["autonomy"]["mode"] == "balanced", "autonomy.mode should default to 'balanced'"
        assert result["wiki"]["domain"] == "general", "domain should default to 'general'"

    def test_required_wiki_section(self, tmp_path):
        """Config without a 'wiki:' section raises an error."""
        from parse_config import parse_config

        p = tmp_path / "wiki.config.yaml"
        p.write_text(yaml.dump({"autonomy": {"mode": "balanced"}}))
        with pytest.raises(ValueError, match="wiki"):
            parse_config(str(p))

    def test_required_wiki_name(self, tmp_path):
        """Config without 'wiki.name' raises an error."""
        from parse_config import parse_config

        p = tmp_path / "wiki.config.yaml"
        p.write_text(yaml.dump({"wiki": {"domain": "testing"}}))
        with pytest.raises(ValueError, match="name"):
            parse_config(str(p))

    def test_invalid_yaml_raises(self, tmp_path):
        """Malformed YAML raises a clear error."""
        from parse_config import parse_config

        p = tmp_path / "wiki.config.yaml"
        p.write_text("{{invalid: yaml: [unbalanced")
        with pytest.raises(ValueError, match="[Yy]AML|[Pp]ars"):
            parse_config(str(p))

    def test_missing_file_raises(self):
        """Nonexistent file path raises FileNotFoundError."""
        from parse_config import parse_config

        with pytest.raises(FileNotFoundError):
            parse_config("/nonexistent/path/wiki.config.yaml")

    def test_output_is_valid_json(self, valid_config_yaml):
        """When run as a script, stdout is valid JSON."""
        result = subprocess.run(
            [sys.executable, str(Path(SCRIPTS_DIR) / "parse_config.py"),
             "--config", str(valid_config_yaml)],
            capture_output=True, text=True,
        )
        assert result.returncode == 0, f"stderr: {result.stderr}"
        parsed = json.loads(result.stdout)
        assert parsed["wiki"]["name"] == "My Docs"

    def test_autonomy_modes_validated(self, tmp_path):
        """Invalid autonomy mode raises an error."""
        from parse_config import parse_config

        p = tmp_path / "wiki.config.yaml"
        p.write_text(yaml.dump({
            "wiki": {"name": "X"},
            "autonomy": {"mode": "yolo"},
        }))
        with pytest.raises(ValueError, match="[Mm]ode|autonomy"):
            parse_config(str(p))
