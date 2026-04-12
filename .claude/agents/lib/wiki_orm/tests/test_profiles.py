"""Tests for ORM profile loader."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from wiki_orm.profiles import load_profile, load_all_profiles, detect_orm, OrmProfile

PROFILES_DIR = Path(__file__).resolve().parent.parent / "profiles"
FIXTURES_DIR = Path(__file__).resolve().parent / "fixtures"


class TestLoadProfile:
    def test_load_jpa_profile(self):
        p = load_profile(str(PROFILES_DIR / "jpa.yaml"))
        assert p.name == "jpa"
        assert p.language == "java"
        assert len(p.markers) >= 2

    def test_load_sqlalchemy_profile(self):
        p = load_profile(str(PROFILES_DIR / "sqlalchemy.yaml"))
        assert p.name == "sqlalchemy"
        assert p.language == "python"

    def test_load_django_profile(self):
        p = load_profile(str(PROFILES_DIR / "django.yaml"))
        assert p.name == "django"
        assert p.language == "python"

    def test_load_prisma_profile(self):
        p = load_profile(str(PROFILES_DIR / "prisma.yaml"))
        assert p.name == "prisma"
        assert p.language == "typescript"

    def test_load_typeorm_profile(self):
        p = load_profile(str(PROFILES_DIR / "typeorm.yaml"))
        assert p.name == "typeorm"
        assert p.language == "typescript"
        assert len(p.markers) >= 2

    def test_load_entity_framework_profile(self):
        p = load_profile(str(PROFILES_DIR / "entity_framework.yaml"))
        assert p.name == "entity_framework"
        assert p.language == "csharp"
        assert len(p.markers) >= 2

    def test_load_activerecord_profile(self):
        p = load_profile(str(PROFILES_DIR / "activerecord.yaml"))
        assert p.name == "activerecord"
        assert p.language == "ruby"
        assert len(p.markers) >= 2

    def test_missing_file_raises(self):
        with pytest.raises(FileNotFoundError):
            load_profile("/nonexistent/profile.yaml")

    def test_missing_required_fields(self, tmp_path):
        bad = tmp_path / "bad.yaml"
        bad.write_text("name: test\nlanguage: python\n")
        with pytest.raises(ValueError, match="missing required fields"):
            load_profile(str(bad))

    def test_profile_has_markers(self):
        p = load_profile(str(PROFILES_DIR / "jpa.yaml"))
        marker_types = [m.type for m in p.markers]
        assert "entity_class" in marker_types

    def test_profile_has_relationship_patterns(self):
        p = load_profile(str(PROFILES_DIR / "jpa.yaml"))
        assert len(p.relationship_patterns) >= 1


class TestLoadAllProfiles:
    def test_loads_shipped_profiles(self):
        profiles = load_all_profiles(str(PROFILES_DIR))
        names = [p.name for p in profiles]
        assert "jpa" in names
        assert "sqlalchemy" in names
        assert "django" in names
        assert "prisma" in names
        assert "typeorm" in names
        assert "entity_framework" in names
        assert "activerecord" in names

    def test_empty_dir_returns_empty(self, tmp_path):
        profiles = load_all_profiles(str(tmp_path))
        assert profiles == []


class TestDetectOrm:
    def test_detect_jpa(self):
        fixtures = FIXTURES_DIR / "jpa"
        contents = {}
        for f in fixtures.glob("*.java"):
            contents[str(f)] = f.read_text()
        profiles = load_all_profiles(str(PROFILES_DIR))
        matches = detect_orm(contents, profiles)
        assert len(matches) >= 1
        assert matches[0].name == "jpa"

    def test_detect_sqlalchemy(self):
        fixtures = FIXTURES_DIR / "sqlalchemy"
        contents = {}
        for f in fixtures.glob("*.py"):
            contents[str(f)] = f.read_text()
        profiles = load_all_profiles(str(PROFILES_DIR))
        matches = detect_orm(contents, profiles)
        names = [m.name for m in matches]
        assert "sqlalchemy" in names

    def test_detect_django(self):
        fixtures = FIXTURES_DIR / "django"
        contents = {}
        for f in fixtures.glob("*.py"):
            contents[str(f)] = f.read_text()
        profiles = load_all_profiles(str(PROFILES_DIR))
        matches = detect_orm(contents, profiles)
        names = [m.name for m in matches]
        assert "django" in names

    def test_detect_typeorm(self):
        fixtures = FIXTURES_DIR / "typeorm"
        contents = {}
        for f in fixtures.glob("*.ts"):
            contents[str(f)] = f.read_text()
        profiles = load_all_profiles(str(PROFILES_DIR))
        matches = detect_orm(contents, profiles)
        names = [m.name for m in matches]
        assert "typeorm" in names

    def test_detect_entity_framework(self):
        fixtures = FIXTURES_DIR / "entity_framework"
        contents = {}
        for f in fixtures.glob("*.cs"):
            contents[str(f)] = f.read_text()
        profiles = load_all_profiles(str(PROFILES_DIR))
        matches = detect_orm(contents, profiles)
        names = [m.name for m in matches]
        assert "entity_framework" in names

    def test_detect_activerecord(self):
        fixtures = FIXTURES_DIR / "activerecord"
        contents = {}
        for f in fixtures.glob("*.rb"):
            contents[str(f)] = f.read_text()
        profiles = load_all_profiles(str(PROFILES_DIR))
        matches = detect_orm(contents, profiles)
        names = [m.name for m in matches]
        assert "activerecord" in names

    def test_no_match_returns_empty(self):
        contents = {"readme.md": "# Just a readme\nNo ORM here."}
        profiles = load_all_profiles(str(PROFILES_DIR))
        matches = detect_orm(contents, profiles)
        assert matches == []
