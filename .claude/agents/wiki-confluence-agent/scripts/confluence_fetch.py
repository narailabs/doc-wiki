#!/usr/bin/env python3
from __future__ import annotations

"""Confluence data fetcher for the wiki-confluence-agent.

Library usage:
    from confluence_fetch import fetch
    result = fetch("cql_search", {"cql": "space = DEV AND type = page"})

CLI usage:
    python confluence_fetch.py --action cql_search --params '{"cql": "space = DEV"}'
    python confluence_fetch.py --action get_page --params '{"page_id": "12345678"}'
    python confluence_fetch.py --action get_space --params '{"space_key": "DEV"}'
"""

import argparse
import json
import re
import sys
from typing import Any

VALID_ACTIONS = {"cql_search", "get_page", "get_space"}

MAX_RESULTS_DEFAULT = 25
MAX_RESULTS_CAP = 500

PAGE_ID_PATTERN = re.compile(r"^\d+$")
SPACE_KEY_PATTERN = re.compile(r"^[A-Z][A-Z0-9]{1,19}$")


def _validate_cql_search(params: dict[str, Any]) -> dict[str, Any]:
    """Validate params for cql_search action."""
    cql = params.get("cql")
    if not cql or not isinstance(cql, str):
        raise ValueError("cql_search requires a non-empty 'cql' string")
    max_results = min(
        int(params.get("max_results", MAX_RESULTS_DEFAULT)),
        MAX_RESULTS_CAP,
    )
    return {"cql": cql.strip(), "max_results": max_results}


def _validate_get_page(params: dict[str, Any]) -> dict[str, Any]:
    """Validate params for get_page action."""
    page_id = str(params.get("page_id", ""))
    if not PAGE_ID_PATTERN.match(page_id):
        raise ValueError(
            f"Invalid page_id '{page_id}' — expected numeric ID"
        )
    expand = params.get("expand", [])
    if not isinstance(expand, list):
        raise ValueError("'expand' must be a list of strings")
    return {"page_id": page_id, "expand": expand}


def _validate_get_space(params: dict[str, Any]) -> dict[str, Any]:
    """Validate params for get_space action."""
    space_key = params.get("space_key", "")
    if not SPACE_KEY_PATTERN.match(space_key):
        raise ValueError(
            f"Invalid space_key '{space_key}' — expected uppercase key like DEV"
        )
    return {"space_key": space_key}


_VALIDATORS = {
    "cql_search": _validate_cql_search,
    "get_page": _validate_get_page,
    "get_space": _validate_get_space,
}


def fetch(action: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
    """Fetch data from Confluence.

    Args:
        action: One of cql_search, get_page, get_space.
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
        if action == "cql_search":
            return _fetch_cql_search(validated)
        elif action == "get_page":
            return _fetch_get_page(validated)
        elif action == "get_space":
            return _fetch_get_space(validated)
    except Exception as exc:  # noqa: BLE001
        return {
            "status": "error",
            "error_code": "CONNECTION_ERROR",
            "message": f"Confluence API call failed: {exc}",
        }

    return {"status": "error", "error_code": "UNKNOWN", "message": "Unexpected state"}


def _fetch_cql_search(validated: dict[str, Any]) -> dict[str, Any]:
    """Execute CQL search against Confluence API."""
    # PLACEHOLDER: actual Confluence REST API call
    # response = requests.get(
    #     f"{base_url}/rest/api/content/search",
    #     params={"cql": validated["cql"], "limit": validated["max_results"]},
    #     headers=headers,
    #     timeout=30,
    # )
    return {
        "status": "success",
        "action": "cql_search",
        "data": {
            "total": 0,
            "pages": [],
        },
        "truncated": False,
    }


def _fetch_get_page(validated: dict[str, Any]) -> dict[str, Any]:
    """Fetch a single Confluence page."""
    # PLACEHOLDER: actual Confluence REST API call
    # response = requests.get(
    #     f"{base_url}/rest/api/content/{validated['page_id']}",
    #     params={"expand": ",".join(validated["expand"])},
    #     headers=headers,
    #     timeout=30,
    # )
    return {
        "status": "success",
        "action": "get_page",
        "data": {
            "id": validated["page_id"],
            "title": "",
            "space_key": "",
            "version": 0,
            "body_markdown": "",
            "last_modified": None,
        },
    }


def _fetch_get_space(validated: dict[str, Any]) -> dict[str, Any]:
    """Fetch Confluence space metadata."""
    # PLACEHOLDER: actual Confluence REST API call
    # response = requests.get(
    #     f"{base_url}/rest/api/space/{validated['space_key']}",
    #     headers=headers,
    #     timeout=30,
    # )
    return {
        "status": "success",
        "action": "get_space",
        "data": {
            "key": validated["space_key"],
            "name": "",
            "description": "",
            "type": "global",
            "homepage_id": None,
        },
    }


def main() -> None:
    """CLI entry point."""
    parser = argparse.ArgumentParser(description="Fetch data from Confluence")
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
