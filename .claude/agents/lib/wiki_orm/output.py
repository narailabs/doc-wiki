"""Output generator — produces database-mapping.md with Mermaid ER diagrams."""
from __future__ import annotations

from datetime import date
from typing import List, Optional

from .extractor import ExtractedEntity


def generate_mapping_markdown(
    entities: List[ExtractedEntity],
    project_name: str = "Project",
    orm_profile: str = "unknown",
    unmapped_tables: Optional[List[str]] = None,
    dual_access_tables: Optional[List[str]] = None,
) -> str:
    """Generate a database-mapping.md document.

    Args:
        entities: list of extracted entities
        project_name: name of the project
        orm_profile: name of the ORM profile used
        unmapped_tables: tables in DB with no entity
        dual_access_tables: tables accessed by both ORM and direct queries

    Returns:
        Markdown string with frontmatter, mapping table, and Mermaid ER diagram.
    """
    today = date.today().isoformat()
    unmapped = unmapped_tables or []
    dual = dual_access_tables or []

    lines = []

    # Frontmatter
    lines.append("---")
    lines.append(f"title: Database Mapping — {project_name}")
    lines.append("type: entity")
    tags = ["database", "orm", orm_profile]
    lines.append(f"tags: [{', '.join(tags)}]")
    lines.append(f"generated_by: orm-mapper")
    lines.append(f"orm_profile: {orm_profile}")
    lines.append(f"created: {today}")
    lines.append(f"updated: {today}")
    lines.append(f'summary: "Auto-generated database mapping for {project_name} using {orm_profile} ORM profile."')
    lines.append("---")
    lines.append("")

    # Entity-Table Mapping
    lines.append("## Entity-Table Mapping")
    lines.append("")
    lines.append("| Entity Class | Schema.Table | Columns | Relationships |")
    lines.append("|---|---|---|---|")

    for entity in entities:
        schema_table = f"{entity.schema_name}.{entity.table_name}" if entity.schema_name else entity.table_name
        col_count = len(entity.columns)
        rel_types = [r.type for r in entity.relationships]
        rel_str = ", ".join(rel_types) if rel_types else "—"
        lines.append(f"| {entity.class_name} | {schema_table} | {col_count} | {rel_str} |")

    lines.append("")

    # Unmapped tables
    if unmapped:
        lines.append("## Unmapped Tables")
        lines.append("")
        lines.append("Tables in the database with no corresponding entity:")
        lines.append("")
        for table in unmapped:
            lines.append(f"- `{table}`")
        lines.append("")

    # Dual access
    if dual:
        lines.append("## Dual-Access Tables")
        lines.append("")
        lines.append("Tables accessed by BOTH ORM entities AND direct queries:")
        lines.append("")
        for table in dual:
            lines.append(f"- `{table}`")
        lines.append("")

    # Mermaid ER diagram
    if entities:
        lines.append("## Entity Relationship Diagram")
        lines.append("")
        lines.append("```mermaid")
        lines.append("erDiagram")
        for entity in entities:
            table = entity.table_name
            # Add columns
            if entity.columns:
                lines.append(f"    {table} {{")
                for col in entity.columns:
                    lines.append(f"        string {col.name}")
                lines.append("    }")

        # Add relationships
        seen_rels = set()
        for entity in entities:
            for rel in entity.relationships:
                if rel.type in ("one_to_many", "many_to_many"):
                    rel_key = (entity.table_name, rel.type)
                    if rel_key not in seen_rels:
                        seen_rels.add(rel_key)
                        cardinality = "||--o{" if rel.type == "one_to_many" else "}o--o{"
                        lines.append(f'    {entity.table_name} {cardinality} {entity.table_name}_rel : ""')

        lines.append("```")
        lines.append("")

    return "\n".join(lines)
