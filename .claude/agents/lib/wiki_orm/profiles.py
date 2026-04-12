"""ORM profile loader — reads YAML profiles describing ORM detection patterns."""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional

import yaml


REQUIRED_FIELDS = {"name", "language", "detection", "entity_extraction"}
PROFILES_DIR = Path(__file__).parent / "profiles"


@dataclass
class MarkerPattern:
    pattern: str
    type: str


@dataclass
class OrmProfile:
    name: str
    language: str
    description: str = ""
    file_patterns: List[str] = field(default_factory=list)
    markers: List[MarkerPattern] = field(default_factory=list)
    class_pattern: str = ""
    table_pattern: str = ""
    column_pattern: str = ""
    relationship_patterns: List[MarkerPattern] = field(default_factory=list)
    naming_conventions: Dict[str, str] = field(default_factory=dict)


def load_profile(path: str) -> OrmProfile:
    """Load an ORM profile from a YAML file."""
    p = Path(path)
    if not p.exists():
        raise FileNotFoundError(f"Profile not found: {path}")

    with open(p) as f:
        data = yaml.safe_load(f)

    if not isinstance(data, dict):
        raise ValueError(f"Invalid profile format in {path}")

    missing = REQUIRED_FIELDS - set(data.keys())
    if missing:
        raise ValueError(f"Profile {path} missing required fields: {missing}")

    detection = data.get("detection", {})
    extraction = data.get("entity_extraction", {})
    relationships = data.get("relationship_detection", {})

    markers = [
        MarkerPattern(pattern=m["pattern"], type=m["type"])
        for m in detection.get("markers", [])
    ]
    rel_patterns = [
        MarkerPattern(pattern=r["pattern"], type=r["type"])
        for r in relationships.get("patterns", [])
    ]

    return OrmProfile(
        name=data["name"],
        language=data["language"],
        description=data.get("description", ""),
        file_patterns=detection.get("file_patterns", []),
        markers=markers,
        class_pattern=extraction.get("class_pattern", ""),
        table_pattern=extraction.get("table_pattern", ""),
        column_pattern=extraction.get("column_pattern", ""),
        relationship_patterns=rel_patterns,
        naming_conventions=data.get("naming_conventions", {}),
    )


def load_all_profiles(profiles_dir: Optional[str] = None) -> List[OrmProfile]:
    """Load all YAML profiles from a directory."""
    d = Path(profiles_dir) if profiles_dir else PROFILES_DIR
    if not d.exists():
        return []
    profiles = []
    for f in sorted(d.glob("*.yaml")):
        try:
            profiles.append(load_profile(str(f)))
        except (ValueError, yaml.YAMLError):
            continue
    return profiles


def detect_orm(file_contents: Dict[str, str], profiles: Optional[List[OrmProfile]] = None) -> List[OrmProfile]:
    """Detect which ORM profiles match a codebase.

    Args:
        file_contents: dict of {relative_path: file_content}
        profiles: list of profiles to check (default: load all shipped profiles)

    Returns:
        List of matching profiles, ordered by match strength.
    """
    if profiles is None:
        profiles = load_all_profiles()

    matches = []
    for profile in profiles:
        score = 0
        for marker in profile.markers:
            for content in file_contents.values():
                if marker.pattern in content:
                    score += 1
                    break
        if score > 0:
            matches.append((score, profile))

    matches.sort(key=lambda x: x[0], reverse=True)
    return [p for _, p in matches]
