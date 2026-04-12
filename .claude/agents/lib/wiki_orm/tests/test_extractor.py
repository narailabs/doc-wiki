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


class TestExtractTypeORM:
    @pytest.fixture
    def typeorm_profile(self):
        return load_profile(str(PROFILES_DIR / "typeorm.yaml"))

    @pytest.fixture
    def typeorm_files(self):
        fixtures = FIXTURES_DIR / "typeorm"
        return {str(f): f.read_text() for f in fixtures.glob("*.ts")}

    def test_finds_entity_classes(self, typeorm_profile, typeorm_files):
        entities = extract_entities(typeorm_files, typeorm_profile)
        class_names = [e.class_name for e in entities]
        assert "User" in class_names
        assert "Order" in class_names

    def test_extracts_table_name(self, typeorm_profile, typeorm_files):
        entities = extract_entities(typeorm_files, typeorm_profile)
        user = [e for e in entities if e.class_name == "User"][0]
        assert user.table_name == "users"

    def test_extracts_relationships(self, typeorm_profile, typeorm_files):
        entities = extract_entities(typeorm_files, typeorm_profile)
        user = [e for e in entities if e.class_name == "User"][0]
        rel_types = [r.type for r in user.relationships]
        assert "one_to_many" in rel_types

    def test_extracts_many_to_one(self, typeorm_profile, typeorm_files):
        entities = extract_entities(typeorm_files, typeorm_profile)
        order = [e for e in entities if e.class_name == "Order"][0]
        rel_types = [r.type for r in order.relationships]
        assert "many_to_one" in rel_types


class TestExtractEntityFramework:
    @pytest.fixture
    def ef_profile(self):
        return load_profile(str(PROFILES_DIR / "entity_framework.yaml"))

    @pytest.fixture
    def ef_files(self):
        fixtures = FIXTURES_DIR / "entity_framework"
        return {str(f): f.read_text() for f in fixtures.glob("*.cs")}

    def test_finds_entity_classes(self, ef_profile, ef_files):
        entities = extract_entities(ef_files, ef_profile)
        class_names = [e.class_name for e in entities]
        assert "User" in class_names

    def test_extracts_table_name(self, ef_profile, ef_files):
        entities = extract_entities(ef_files, ef_profile)
        user = [e for e in entities if e.class_name == "User"][0]
        assert user.table_name == "users"

    def test_extracts_columns(self, ef_profile, ef_files):
        entities = extract_entities(ef_files, ef_profile)
        user = [e for e in entities if e.class_name == "User"][0]
        col_names = [c.name for c in user.columns]
        assert "username" in col_names

    def test_extracts_relationships(self, ef_profile, ef_files):
        entities = extract_entities(ef_files, ef_profile)
        # The DbContext file contains .HasOne and .WithMany
        all_rel_types = []
        for e in entities:
            all_rel_types.extend(r.type for r in e.relationships)
        assert "one_to_one" in all_rel_types or "many_to_many" in all_rel_types


class TestExtractActiveRecord:
    @pytest.fixture
    def ar_profile(self):
        return load_profile(str(PROFILES_DIR / "activerecord.yaml"))

    @pytest.fixture
    def ar_files(self):
        fixtures = FIXTURES_DIR / "activerecord"
        return {str(f): f.read_text() for f in fixtures.glob("*.rb")}

    def test_finds_entity_classes(self, ar_profile, ar_files):
        entities = extract_entities(ar_files, ar_profile)
        class_names = [e.class_name for e in entities]
        assert "User" in class_names
        assert "Order" in class_names

    def test_infers_table_name(self, ar_profile, ar_files):
        entities = extract_entities(ar_files, ar_profile)
        user = [e for e in entities if e.class_name == "User"][0]
        assert user.table_name == "users"

    def test_extracts_has_many(self, ar_profile, ar_files):
        entities = extract_entities(ar_files, ar_profile)
        user = [e for e in entities if e.class_name == "User"][0]
        rel_types = [r.type for r in user.relationships]
        assert "one_to_many" in rel_types

    def test_extracts_belongs_to(self, ar_profile, ar_files):
        entities = extract_entities(ar_files, ar_profile)
        order = [e for e in entities if e.class_name == "Order"][0]
        rel_types = [r.type for r in order.relationships]
        assert "many_to_one" in rel_types


class TestExtractEmpty:
    def test_no_entities_from_non_orm_code(self):
        profile = load_profile(str(PROFILES_DIR / "jpa.yaml"))
        files = {"readme.md": "# No ORM here"}
        entities = extract_entities(files, profile)
        assert entities == []
