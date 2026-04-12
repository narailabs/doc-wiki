"""Entity/table/relationship extraction from source files using ORM profiles."""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Dict, List, Optional

from .profiles import OrmProfile


@dataclass
class ExtractedColumn:
    name: str
    source_field: str = ""


@dataclass
class ExtractedRelationship:
    type: str  # one_to_many, many_to_one, many_to_many, one_to_one, relationship, foreign_key
    target_entity: str = ""
    source_line: str = ""


@dataclass
class ExtractedEntity:
    class_name: str
    table_name: str = ""
    schema_name: str = ""
    columns: List[ExtractedColumn] = field(default_factory=list)
    relationships: List[ExtractedRelationship] = field(default_factory=list)
    source_file: str = ""


def extract_entities(file_contents: Dict[str, str], profile: OrmProfile) -> List[ExtractedEntity]:
    """Extract entity definitions from source files using an ORM profile.

    Args:
        file_contents: dict of {relative_path: file_content}
        profile: the matched ORM profile

    Returns:
        List of extracted entities with table mappings and relationships.
    """
    entities = []

    for file_path, content in file_contents.items():
        # Find entity classes
        if not profile.class_pattern:
            continue

        for match in re.finditer(profile.class_pattern, content, re.MULTILINE):
            class_name = match.group(1)
            entity = ExtractedEntity(class_name=class_name, source_file=file_path)

            # Extract table name
            if profile.table_pattern:
                table_match = re.search(profile.table_pattern, content, re.DOTALL)
                if table_match:
                    entity.table_name = table_match.group(1)
                    if table_match.lastindex and table_match.lastindex >= 2 and table_match.group(2):
                        entity.schema_name = table_match.group(2)

            # If no explicit table name, infer from class name
            if not entity.table_name:
                entity.table_name = _class_to_table(class_name, profile)

            # Extract columns
            if profile.column_pattern:
                for col_match in re.finditer(profile.column_pattern, content):
                    col_name = col_match.group(1)
                    entity.columns.append(ExtractedColumn(
                        name=col_name,
                        source_field=col_name,
                    ))

            # Extract relationships
            for rel_pattern in profile.relationship_patterns:
                if re.search(rel_pattern.pattern, content):
                    entity.relationships.append(ExtractedRelationship(
                        type=rel_pattern.type,
                        source_line=rel_pattern.pattern,
                    ))

            entities.append(entity)

    return entities


def _class_to_table(class_name: str, profile: OrmProfile) -> str:
    """Infer table name from class name based on naming conventions."""
    convention = profile.naming_conventions.get("table_from_class", "snake_case")

    if convention == "lower_case":
        return class_name.lower()
    elif convention == "snake_case":
        return _to_snake_case(class_name)
    elif convention == "snake_case_plural":
        return _to_snake_case(class_name) + "s"
    else:
        return class_name.lower()


def _to_snake_case(name: str) -> str:
    """Convert CamelCase to snake_case."""
    result = re.sub(r"(?<=[a-z0-9])([A-Z])", r"_\1", name)
    return result.lower()
