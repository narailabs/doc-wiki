"""Tests for entity extraction using ORM profiles."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from wiki_orm.extractor import extract_entities
from wiki_orm.profiles import load_profile

PROFILES_DIR = Path(__file__).resolve().parent.parent / "profiles"
FIXTURES_DIR = Path(__file__).resolve().parent / "fixtures"


class TestExtractJPA:
    @pytest.fixture
    def jpa_profile(self):
        return load_profile(str(PROFILES_DIR / "jpa.yaml"))

    @pytest.fixture
    def jpa_files(self):
        fixtures = FIXTURES_DIR / "jpa"
        return {str(f): f.read_text() for f in fixtures.glob("*.java")}

    def test_finds_entity_classes(self, jpa_profile, jpa_files):
        entities = extract_entities(jpa_files, jpa_profile)
        class_names = [e.class_name for e in entities]
        assert "User" in class_names
        assert "Order" in class_names

    def test_extracts_table_name(self, jpa_profile, jpa_files):
        entities = extract_entities(jpa_files, jpa_profile)
        user = [e for e in entities if e.class_name == "User"][0]
        assert user.table_name == "users"

    def test_extracts_schema(self, jpa_profile, jpa_files):
        entities = extract_entities(jpa_files, jpa_profile)
        user = [e for e in entities if e.class_name == "User"][0]
        assert user.schema_name == "public"

    def test_extracts_columns(self, jpa_profile, jpa_files):
        entities = extract_entities(jpa_files, jpa_profile)
        user = [e for e in entities if e.class_name == "User"][0]
        col_names = [c.name for c in user.columns]
        assert "username" in col_names

    def test_extracts_relationships(self, jpa_profile, jpa_files):
        entities = extract_entities(jpa_files, jpa_profile)
        user = [e for e in entities if e.class_name == "User"][0]
        rel_types = [r.type for r in user.relationships]
        assert "one_to_many" in rel_types or "many_to_many" in rel_types


class TestExtractSQLAlchemy:
    @pytest.fixture
    def sa_profile(self):
        return load_profile(str(PROFILES_DIR / "sqlalchemy.yaml"))

    @pytest.fixture
    def sa_files(self):
        fixtures = FIXTURES_DIR / "sqlalchemy"
        return {str(f): f.read_text() for f in fixtures.glob("*.py")}

    def test_finds_entity_classes(self, sa_profile, sa_files):
        entities = extract_entities(sa_files, sa_profile)
        class_names = [e.class_name for e in entities]
        assert "User" in class_names

    def test_extracts_table_name(self, sa_profile, sa_files):
        entities = extract_entities(sa_files, sa_profile)
        user = [e for e in entities if e.class_name == "User"][0]
        assert user.table_name == "users"


class TestExtractDjango:
    @pytest.fixture
    def django_profile(self):
        return load_profile(str(PROFILES_DIR / "django.yaml"))

    @pytest.fixture
    def django_files(self):
        fixtures = FIXTURES_DIR / "django"
        return {str(f): f.read_text() for f in fixtures.glob("*.py")}

    def test_finds_entity_classes(self, django_profile, django_files):
        entities = extract_entities(django_files, django_profile)
        class_names = [e.class_name for e in entities]
        assert "User" in class_names

    def test_extracts_table_name(self, django_profile, django_files):
        entities = extract_entities(django_files, django_profile)
        user = [e for e in entities if e.class_name == "User"][0]
        assert user.table_name == "users"

    def test_detects_relationships(self, django_profile, django_files):
        entities = extract_entities(django_files, django_profile)
        order = [e for e in entities if e.class_name == "Order"][0]
        rel_types = [r.type for r in order.relationships]
        assert "many_to_one" in rel_types


class TestExtractEmpty:
    def test_no_entities_from_non_orm_code(self):
        profile = load_profile(str(PROFILES_DIR / "jpa.yaml"))
        files = {"readme.md": "# No ORM here"}
        entities = extract_entities(files, profile)
        assert entities == []
