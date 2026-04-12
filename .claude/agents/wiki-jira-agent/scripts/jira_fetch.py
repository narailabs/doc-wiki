#!/usr/bin/env python3
from __future__ import annotations

"""Jira data fetcher for the wiki-jira-agent.

Library usage:
    from jira_fetch import fetch
    result = fetch("jql_search", {"jql": "project = WIKI", "max_results": 50})

CLI usage:
    python jira_fetch.py --action jql_search --params '{"jql": "project = WIKI"}'
    python jira_fetch.py --action get_issue --params '{"issue_key": "WIKI-123"}'
    python jira_fetch.py --action get_project --params '{"project_key": "WIKI"}'
"""

import argparse
import json
import re
import sys
from typing import Any

VALID_ACTIONS = {"jql_search", "get_issue", "get_project"}

MAX_RESULTS_DEFAULT = 50
MAX_RESULTS_CAP = 1000

ISSUE_KEY_PATTERN = re.compile(r"^[A-Z][A-Z0-9]+-\d+$")
PROJECT_KEY_PATTERN = re.compile(r"^[A-Z][A-Z0-9]+$")


def _validate_jql_search(params: dict[str, Any]) -> dict[str, Any]:
    """Validate params for jql_search action."""
    jql = params.get("jql")
    if not jql or not isinstance(jql, str):
        raise ValueError("jql_search requires a non-empty 'jql' string")
    max_results = min(
        int(params.get("max_results", MAX_RESULTS_DEFAULT)),
        MAX_RESULTS_CAP,
    )
    return {"jql": jql.strip(), "max_results": max_results}


def _validate_get_issue(params: dict[str, Any]) -> dict[str, Any]:
    """Validate params for get_issue action."""
    issue_key = params.get("issue_key", "")
    if not ISSUE_KEY_PATTERN.match(issue_key):
        raise ValueError(
            f"Invalid issue_key '{issue_key}' — expected format like PROJ-123"
        )
    expand = params.get("expand", [])
    if not isinstance(expand, list):
        raise ValueError("'expand' must be a list of strings")
    return {"issue_key": issue_key, "expand": expand}


def _validate_get_project(params: dict[str, Any]) -> dict[str, Any]:
    """Validate params for get_project action."""
    project_key = params.get("project_key", "")
    if not PROJECT_KEY_PATTERN.match(project_key):
        raise ValueError(
            f"Invalid project_key '{project_key}' — expected format like PROJ"
        )
    return {"project_key": project_key}


_VALIDATORS = {
    "jql_search": _validate_jql_search,
    "get_issue": _validate_get_issue,
    "get_project": _validate_get_project,
}


def fetch(action: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
    """Fetch data from Jira.

    Args:
        action: One of jql_search, get_issue, get_project.
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
        if action == "jql_search":
            return _fetch_jql_search(validated)
        elif action == "get_issue":
            return _fetch_get_issue(validated)
        elif action == "get_project":
            return _fetch_get_project(validated)
    except Exception as exc:  # noqa: BLE001
        return {
            "status": "error",
            "error_code": "CONNECTION_ERROR",
            "message": f"Jira API call failed: {exc}",
        }

    # Unreachable but satisfies type checker
    return {"status": "error", "error_code": "UNKNOWN", "message": "Unexpected state"}


def _fetch_jql_search(validated: dict[str, Any]) -> dict[str, Any]:
    """Execute JQL search against Jira API."""
    # PLACEHOLDER: actual Jira REST API call
    # response = requests.get(
    #     f"{base_url}/rest/api/3/search",
    #     params={"jql": validated["jql"], "maxResults": validated["max_results"]},
    #     headers=headers,
    #     timeout=30,
    # )
    return {
        "status": "success",
        "action": "jql_search",
        "data": {
            "total": 0,
            "issues": [],
        },
        "truncated": False,
    }


def _fetch_get_issue(validated: dict[str, Any]) -> dict[str, Any]:
    """Fetch a single Jira issue."""
    # PLACEHOLDER: actual Jira REST API call
    # response = requests.get(
    #     f"{base_url}/rest/api/3/issue/{validated['issue_key']}",
    #     params={"expand": ",".join(validated["expand"])},
    #     headers=headers,
    #     timeout=30,
    # )
    return {
        "status": "success",
        "action": "get_issue",
        "data": {
            "key": validated["issue_key"],
            "summary": "",
            "status": "",
            "assignee": None,
            "labels": [],
            "updated": None,
        },
    }


def _fetch_get_project(validated: dict[str, Any]) -> dict[str, Any]:
    """Fetch Jira project metadata."""
    # PLACEHOLDER: actual Jira REST API call
    # response = requests.get(
    #     f"{base_url}/rest/api/3/project/{validated['project_key']}",
    #     headers=headers,
    #     timeout=30,
    # )
    return {
        "status": "success",
        "action": "get_project",
        "data": {
            "key": validated["project_key"],
            "name": "",
            "description": "",
            "lead": None,
            "issue_types": [],
        },
    }


def main() -> None:
    """CLI entry point."""
    parser = argparse.ArgumentParser(description="Fetch data from Jira")
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
