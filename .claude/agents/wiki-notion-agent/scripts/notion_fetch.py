#!/usr/bin/env python3
from __future__ import annotations

"""Notion data fetcher for the wiki-notion-agent.

Library usage:
    from notion_fetch import fetch
    result = fetch("search", {"query": "architecture", "max_results": 25})

CLI usage:
    python notion_fetch.py --action search --params '{"query": "architecture"}'
    python notion_fetch.py --action get_page --params '{"page_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"}'
    python notion_fetch.py --action get_database --params '{"database_id": "f1e2d3c4-b5a6-7890-abcd-ef1234567890"}'
    python notion_fetch.py --action query_database --params '{"database_id": "...", "filter": {"property": "Status", "status": {"equals": "Done"}}}'
"""

import argparse
import json
import re
import sys
from typing import Any

VALID_ACTIONS = {"search", "get_page", "get_database", "query_database"}

MAX_RESULTS_DEFAULT = 25
MAX_RESULTS_CAP = 100

UUID_PATTERN = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
)
# Notion also accepts UUIDs without dashes
UUID_NO_DASH_PATTERN = re.compile(r"^[0-9a-f]{32}$")


def _validate_uuid(value: str, field_name: str) -> str:
    """Validate a Notion UUID (with or without dashes)."""
    v = value.strip().lower()
    if not UUID_PATTERN.match(v) and not UUID_NO_DASH_PATTERN.match(v):
        raise ValueError(
            f"Invalid {field_name} '{value}' — expected UUID format"
        )
    return v


def _validate_search(params: dict[str, Any]) -> dict[str, Any]:
    """Validate params for search action."""
    query = params.get("query", "")
    if not query or not isinstance(query, str):
        raise ValueError("search requires a non-empty 'query' string")
    filter_type = params.get("filter_type", "")
    if filter_type and filter_type not in {"page", "database"}:
        raise ValueError(f"Invalid filter_type '{filter_type}' — expected page or database")
    max_results = min(
        int(params.get("max_results", MAX_RESULTS_DEFAULT)),
        MAX_RESULTS_CAP,
    )
    return {"query": query.strip(), "filter_type": filter_type, "max_results": max_results}


def _validate_get_page(params: dict[str, Any]) -> dict[str, Any]:
    """Validate params for get_page action."""
    page_id = _validate_uuid(params.get("page_id", ""), "page_id")
    return {"page_id": page_id}


def _validate_get_database(params: dict[str, Any]) -> dict[str, Any]:
    """Validate params for get_database action."""
    database_id = _validate_uuid(params.get("database_id", ""), "database_id")
    return {"database_id": database_id}


def _validate_query_database(params: dict[str, Any]) -> dict[str, Any]:
    """Validate params for query_database action."""
    database_id = _validate_uuid(params.get("database_id", ""), "database_id")
    db_filter = params.get("filter")
    if db_filter is not None and not isinstance(db_filter, dict):
        raise ValueError("'filter' must be a dict (Notion filter object)")
    max_results = min(
        int(params.get("max_results", MAX_RESULTS_DEFAULT)),
        MAX_RESULTS_CAP,
    )
    return {"database_id": database_id, "filter": db_filter, "max_results": max_results}


_VALIDATORS = {
    "search": _validate_search,
    "get_page": _validate_get_page,
    "get_database": _validate_get_database,
    "query_database": _validate_query_database,
}


def fetch(action: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
    """Fetch data from Notion.

    Args:
        action: One of search, get_page, get_database, query_database.
        params: Action-specific parameters.

    Returns:
        Structured result dict with status, action, and data fields.
    """
    if action not in VALID_ACTIONS:
        return {
            "status": "error",
            "error_code": "VALIDATION_ERROR",
            "message": f"Unknown action '{action}' — expected one of {sorted(VALID_ACTIONS)}",
        }

    params = params or {}

    try:
        validated = _VALIDATORS[action](params)
    except (ValueError, TypeError) as exc:
        return {
            "status": "error",
            "error_code": "VALIDATION_ERROR",
            "message": str(exc),
        }

    try:
        handler = _HANDLERS[action]
        return handler(validated)
    except Exception as exc:  # noqa: BLE001
        return {
            "status": "error",
            "error_code": "CONNECTION_ERROR",
            "message": f"Notion API call failed: {exc}",
        }


def _fetch_search(validated: dict[str, Any]) -> dict[str, Any]:
    """Search Notion workspace."""
    # PLACEHOLDER: actual Notion API call
    # response = requests.post(
    #     "https://api.notion.com/v1/search",
    #     headers={"Authorization": f"Bearer {token}", "Notion-Version": "2022-06-28"},
    #     json={"query": validated["query"], "page_size": validated["max_results"]},
    #     timeout=30,
    # )
    return {
        "status": "success",
        "action": "search",
        "data": {
            "total": 0,
            "results": [],
        },
        "truncated": False,
    }


def _fetch_get_page(validated: dict[str, Any]) -> dict[str, Any]:
    """Fetch a single Notion page."""
    # PLACEHOLDER: actual Notion API call
    # response = requests.get(
    #     f"https://api.notion.com/v1/pages/{validated['page_id']}",
    #     headers={"Authorization": f"Bearer {token}", "Notion-Version": "2022-06-28"},
    #     timeout=30,
    # )
    return {
        "status": "success",
        "action": "get_page",
        "data": {
            "id": validated["page_id"],
            "title": "",
            "parent_type": "",
            "last_edited": None,
            "properties": {},
            "content_markdown": "",
        },
    }


def _fetch_get_database(validated: dict[str, Any]) -> dict[str, Any]:
    """Fetch Notion database metadata."""
    # PLACEHOLDER: actual Notion API call
    # response = requests.get(
    #     f"https://api.notion.com/v1/databases/{validated['database_id']}",
    #     headers={"Authorization": f"Bearer {token}", "Notion-Version": "2022-06-28"},
    #     timeout=30,
    # )
    return {
        "status": "success",
        "action": "get_database",
        "data": {
            "id": validated["database_id"],
            "title": "",
            "description": "",
            "properties": {},
            "is_inline": False,
        },
    }


def _fetch_query_database(validated: dict[str, Any]) -> dict[str, Any]:
    """Query a Notion database with filters."""
    # PLACEHOLDER: actual Notion API call
    # body = {"page_size": validated["max_results"]}
    # if validated["filter"]:
    #     body["filter"] = validated["filter"]
    # response = requests.post(
    #     f"https://api.notion.com/v1/databases/{validated['database_id']}/query",
    #     headers={"Authorization": f"Bearer {token}", "Notion-Version": "2022-06-28"},
    #     json=body,
    #     timeout=30,
    # )
    return {
        "status": "success",
        "action": "query_database",
        "data": {
            "database_id": validated["database_id"],
            "total": 0,
            "results": [],
        },
        "truncated": False,
    }


_HANDLERS = {
    "search": _fetch_search,
    "get_page": _fetch_get_page,
    "get_database": _fetch_get_database,
    "query_database": _fetch_query_database,
}


def main() -> None:
    """CLI entry point."""
    parser = argparse.ArgumentParser(description="Fetch data from Notion")
    parser.add_argument(
        "--action",
        required=True,
        choices=sorted(VALID_ACTIONS),
        help="Action to perform",
    )
    parser.add_argument(
        "--params",
        default="{}",
        help="JSON string of action parameters",
    )
    args = parser.parse_args()

    try:
        params = json.loads(args.params)
    except json.JSONDecodeError as exc:
        result = {
            "status": "error",
            "error_code": "VALIDATION_ERROR",
            "message": f"Invalid JSON in --params: {exc}",
        }
        print(json.dumps(result, indent=2))
        sys.exit(1)

    result = fetch(args.action, params)
    print(json.dumps(result, indent=2))

    if result["status"] != "success":
        sys.exit(1)


if __name__ == "__main__":
    main()
