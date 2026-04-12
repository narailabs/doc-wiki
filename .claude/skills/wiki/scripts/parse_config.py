#!/usr/bin/env python3
"""Parse and validate wiki.config.yaml, outputting the full config as JSON.

Usage:
    python3 parse_config.py --config <path-to-wiki.config.yaml>

Exits 0 on success (JSON to stdout), 1 on validation failure (error to stderr).
"""
import argparse
import json
import sys
from pathlib import Path

import yaml


VALID_AUTONOMY_MODES = {"conservative", "balanced", "autonomous", "auto"}

DEFAULTS = {
    "wiki": {
        "domain": "general",
        "max_depth": 3,
    },
    "autonomy": {
        "mode": "balanced",
    },
}


def parse_config(config_path: str) -> dict:
    """Parse and validate a wiki.config.yaml file.

    Args:
        config_path: Path to the YAML config file.

    Returns:
        Validated config dict with defaults applied.

    Raises:
        FileNotFoundError: If the config file does not exist.
        ValueError: If the YAML is malformed or required fields are missing.
    """
    path = Path(config_path)
    if not path.exists():
        raise FileNotFoundError(f"Config file not found: {config_path}")

    raw = path.read_text()

    try:
        config = yaml.safe_load(raw)
    except yaml.YAMLError as exc:
        raise ValueError(f"Failed to parse YAML: {exc}") from exc

    if not isinstance(config, dict):
        raise ValueError("Config must be a YAML mapping, got: " + type(config).__name__)

    # --- Required: wiki section ---
    if "wiki" not in config or not isinstance(config.get("wiki"), dict):
        raise ValueError("Config must contain a 'wiki' section (mapping)")

    wiki = config["wiki"]

    # --- Required: wiki.name ---
    if "name" not in wiki or not wiki["name"]:
        raise ValueError("'wiki.name' is required but missing or empty")

    # --- Apply wiki defaults ---
    wiki.setdefault("domain", DEFAULTS["wiki"]["domain"])
    wiki.setdefault("max_depth", DEFAULTS["wiki"]["max_depth"])

    # --- Apply autonomy defaults ---
    config.setdefault("autonomy", {})
    if not isinstance(config["autonomy"], dict):
        config["autonomy"] = {}
    config["autonomy"].setdefault("mode", DEFAULTS["autonomy"]["mode"])

    # --- Validate autonomy.mode ---
    mode = config["autonomy"]["mode"]
    if mode not in VALID_AUTONOMY_MODES:
        raise ValueError(
            f"Invalid autonomy mode '{mode}'. "
            f"Valid modes: {', '.join(sorted(VALID_AUTONOMY_MODES))}"
        )

    return config


def main():
    parser = argparse.ArgumentParser(description="Parse wiki.config.yaml")
    parser.add_argument("--config", required=True, help="Path to wiki.config.yaml")
    args = parser.parse_args()

    try:
        config = parse_config(args.config)
    except (FileNotFoundError, ValueError) as exc:
        print(json.dumps({"error": str(exc)}), file=sys.stderr)
        sys.exit(1)

    print(json.dumps(config, indent=2))


if __name__ == "__main__":
    main()
