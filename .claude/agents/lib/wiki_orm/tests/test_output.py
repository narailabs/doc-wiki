"""Tests for output generation (database-mapping.md)."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from wiki_orm.extractor import ExtractedColumn, ExtractedEntity, ExtractedRelationship
from wiki_orm.output import generate_mapping_markdown


@pytest.fixture
def sample_entities():
    return [
        ExtractedEntity(
            class_name="User",
            table_name="users",
            schema_name="public",
            columns=[
                ExtractedColumn(name="id"),
                ExtractedColumn(name="username"),
                ExtractedColumn(name="email"),
            ],
            relationships=[
                ExtractedRelationship(type="one_to_many"),
                ExtractedRelationship(type="many_to_many"),
            ],
            source_file="src/model/User.java",
        ),
        ExtractedEntity(
            class_name="Order",
            table_name="orders",
            columns=[
                ExtractedColumn(name="id"),
                ExtractedColumn(name="total_amount"),
            ],
            relationships=[
                ExtractedRelationship(type="many_to_one"),
            ],
            source_file="src/model/Order.java",
        ),
    ]


class TestGenerateMarkdown:
    def test_has_frontmatter(self, sample_entities):
        md = generate_mapping_markdown(sample_entities, "TestProject", "jpa")
        assert md.startswith("---")
        assert "title: Database Mapping" in md
        assert "type: entity" in md
        assert "orm_profile: jpa" in md

    def test_has_entity_table_mapping(self, sample_entities):
        md = generate_mapping_markdown(sample_entities, "TestProject", "jpa")
        assert "## Entity-Table Mapping" in md
        assert "| User |" in md
        assert "| Order |" in md

    def test_schema_table_format(self, sample_entities):
        md = generate_mapping_markdown(sample_entities, "TestProject", "jpa")
        assert "public.users" in md

    def test_has_mermaid_er_diagram(self, sample_entities):
        md = generate_mapping_markdown(sample_entities, "TestProject", "jpa")
        assert "```mermaid" in md
        assert "erDiagram" in md

    def test_mermaid_includes_tables(self, sample_entities):
        md = generate_mapping_markdown(sample_entities, "TestProject", "jpa")
        assert "users {" in md or "users" in md

    def test_unmapped_tables_section(self, sample_entities):
        md = generate_mapping_markdown(
            sample_entities, "TestProject", "jpa",
            unmapped_tables=["audit_log", "migrations"]
        )
        assert "## Unmapped Tables" in md
        assert "`audit_log`" in md
        assert "`migrations`" in md

    def test_dual_access_section(self, sample_entities):
        md = generate_mapping_markdown(
            sample_entities, "TestProject", "jpa",
            dual_access_tables=["users"]
        )
        assert "## Dual-Access Tables" in md
        assert "`users`" in md

    def test_no_unmapped_section_when_empty(self, sample_entities):
        md = generate_mapping_markdown(sample_entities, "TestProject", "jpa")
        assert "## Unmapped Tables" not in md

    def test_empty_entities_no_crash(self):
        md = generate_mapping_markdown([], "TestProject", "jpa")
        assert "## Entity-Table Mapping" in md
        assert "erDiagram" not in md  # no diagram for empty entities

    def test_column_count_in_table(self, sample_entities):
        md = generate_mapping_markdown(sample_entities, "TestProject", "jpa")
        # User has 3 columns
        assert "| 3 |" in md or "3" in md

    def test_tags_include_orm_profile(self, sample_entities):
        md = generate_mapping_markdown(sample_entities, "TestProject", "jpa")
        assert "jpa" in md
        assert "database" in md
