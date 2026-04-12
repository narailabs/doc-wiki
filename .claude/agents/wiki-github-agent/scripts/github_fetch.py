#!/usr/bin/env python3
from __future__ import annotations

"""GitHub data fetcher for the wiki-github-agent.

Library usage:
    from github_fetch import fetch
    result = fetch("repo_info", {"owner": "acme", "repo": "backend"})

CLI usage:
    python github_fetch.py --action repo_info --params '{"owner": "acme", "repo": "backend"}'
    python github_fetch.py --action search_code --params '{"owner": "acme", "repo": "backend", "query": "class Auth"}'
    python github_fetch.py --action get_issues --params '{"owner": "acme", "repo": "backend", "state": "open"}'
    python github_fetch.py --action get_pulls --params '{"owner": "acme", "repo": "backend"}'
    python github_fetch.py --action get_file --params '{"owner": "acme", "repo": "backend", "path": "README.md"}'
"""

import argparse
import json
import re
import sys
from typing import Any

VALID_ACTIONS = {"repo_info", "search_code", "get_issues", "get_pulls", "get_file"}

MAX_RESULTS_DEFAULT = 30
MAX_RESULTS_CAP = 1000
FILE_SIZE_CAP_BYTES = 1_000_000  # 1MB

OWNER_REPO_PATTERN = re.compile(r"^[a-zA-Z0-9_.-]+$")
PATH_PATTERN = re.compile(r"^[a-zA-Z0-9_./ -]+$")


def _validate_owner_repo(params: dict[str, Any]) -> tuple[str, str]:
    """Validate and extract owner/repo from params."""
    owner = params.get("owner", "")
    repo = params.get("repo", "")
    if not OWNER_REPO_PATTERN.match(owner):
        raise ValueError(f"Invalid owner '{owner}' — alphanumeric, dots, dashes, underscores only")
    if not OWNER_REPO_PATTERN.match(repo):
        raise ValueError(f"Invalid repo '{repo}' — alphanumeric, dots, dashes, underscores only")
    return owner, repo


def _validate_repo_info(params: dict[str, Any]) -> dict[str, Any]:
    """Validate params for repo_info action."""
    owner, repo = _validate_owner_repo(params)
    return {"owner": owner, "repo": repo}


def _validate_search_code(params: dict[str, Any]) -> dict[str, Any]:
    """Validate params for search_code action."""
    owner, repo = _validate_owner_repo(params)
    query = params.get("query", "")
    if not query or not isinstance(query, str):
        raise ValueError("search_code requires a non-empty 'query' string")
    max_results = min(
        int(params.get("max_results", MAX_RESULTS_DEFAULT)),
        MAX_RESULTS_CAP,
    )
    return {"owner": owner, "repo": repo, "query": query.strip(), "max_results": max_results}


def _validate_get_issues(params: dict[str, Any]) -> dict[str, Any]:
    """Validate params for get_issues action."""
    owner, repo = _validate_owner_repo(params)
    state = params.get("state", "open")
    if state not in {"open", "closed", "all"}:
        raise ValueError(f"Invalid state '{state}' — expected open, closed, or all")
    labels = params.get("labels", [])
    if not isinstance(labels, list):
        raise ValueError("'labels' must be a list of strings")
    max_results = min(
        int(params.get("max_results", MAX_RESULTS_DEFAULT)),
        MAX_RESULTS_CAP,
    )
    return {"owner": owner, "repo": repo, "state": state, "labels": labels, "max_results": max_results}


def _validate_get_pulls(params: dict[str, Any]) -> dict[str, Any]:
    """Validate params for get_pulls action."""
    owner, repo = _validate_owner_repo(params)
    state = params.get("state", "open")
    if state not in {"open", "closed", "all"}:
        raise ValueError(f"Invalid state '{state}' — expected open, closed, or all")
    max_results = min(
        int(params.get("max_results", MAX_RESULTS_DEFAULT)),
        MAX_RESULTS_CAP,
    )
    return {"owner": owner, "repo": repo, "state": state, "max_results": max_results}


def _validate_get_file(params: dict[str, Any]) -> dict[str, Any]:
    """Validate params for get_file action."""
    owner, repo = _validate_owner_repo(params)
    path = params.get("path", "")
    if not path or not PATH_PATTERN.match(path):
        raise ValueError(f"Invalid path '{path}' — must be a valid file path")
    if ".." in path:
        raise ValueError("Path traversal not allowed — '..' is forbidden")
    ref = params.get("ref", "main")
    return {"owner": owner, "repo": repo, "path": path, "ref": ref}


_VALIDATORS = {
    "repo_info": _validate_repo_info,
    "search_code": _validate_search_code,
    "get_issues": _validate_get_issues,
    "get_pulls": _validate_get_pulls,
    "get_file": _validate_get_file,
}


def fetch(action: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
    """Fetch data from GitHub.

    Args:
        action: One of repo_info, search_code, get_issues, get_pulls, get_file.
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
            "message": f"GitHub API call failed: {exc}",
        }


def _fetch_repo_info(validated: dict[str, Any]) -> dict[str, Any]:
    """Fetch repository metadata."""
    # PLACEHOLDER: actual GitHub REST API call
    # response = requests.get(
    #     f"https://api.github.com/repos/{validated['owner']}/{validated['repo']}",
    #     headers=headers,
    #     timeout=30,
    # )
    return {
        "status": "success",
        "action": "repo_info",
        "data": {
            "full_name": f"{validated['owner']}/{validated['repo']}",
            "description": "",
            "default_branch": "main",
            "language": None,
            "stars": 0,
            "open_issues": 0,
            "topics": [],
            "updated_at": None,
        },
    }


def _fetch_search_code(validated: dict[str, Any]) -> dict[str, Any]:
    """Search code in repository."""
    # PLACEHOLDER: actual GitHub REST API call
    # response = requests.get(
    #     "https://api.github.com/search/code",
    #     params={"q": f"{validated['query']} repo:{validated['owner']}/{validated['repo']}"},
    #     headers=headers,
    #     timeout=30,
    # )
    return {
        "status": "success",
        "action": "search_code",
        "data": {
            "total": 0,
            "items": [],
        },
        "truncated": False,
    }


def _fetch_get_issues(validated: dict[str, Any]) -> dict[str, Any]:
    """Fetch issues from repository."""
    # PLACEHOLDER: actual GitHub REST API call
    # response = requests.get(
    #     f"https://api.github.com/repos/{validated['owner']}/{validated['repo']}/issues",
    #     params={"state": validated["state"], "labels": ",".join(validated["labels"])},
    #     headers=headers,
    #     timeout=30,
    # )
    return {
        "status": "success",
        "action": "get_issues",
        "data": {
            "total": 0,
            "issues": [],
        },
        "truncated": False,
    }


def _fetch_get_pulls(validated: dict[str, Any]) -> dict[str, Any]:
    """Fetch pull requests from repository."""
    # PLACEHOLDER: actual GitHub REST API call
    # response = requests.get(
    #     f"https://api.github.com/repos/{validated['owner']}/{validated['repo']}/pulls",
    #     params={"state": validated["state"]},
    #     headers=headers,
    #     timeout=30,
    # )
    return {
        "status": "success",
        "action": "get_pulls",
        "data": {
            "total": 0,
            "pulls": [],
        },
        "truncated": False,
    }


def _fetch_get_file(validated: dict[str, Any]) -> dict[str, Any]:
    """Fetch a single file from repository."""
    # PLACEHOLDER: actual GitHub REST API call
    # response = requests.get(
    #     f"https://api.github.com/repos/{validated['owner']}/{validated['repo']}/contents/{validated['path']}",
    #     params={"ref": validated["ref"]},
    #     headers=headers,
    #     timeout=30,
    # )
    return {
        "status": "success",
        "action": "get_file",
        "data": {
            "path": validated["path"],
            "ref": validated["ref"],
            "size_bytes": 0,
            "content": "",
            "encoding": "utf-8",
        },
    }


_HANDLERS = {
    "repo_info": _fetch_repo_info,
    "search_code": _fetch_search_code,
    "get_issues": _fetch_get_issues,
    "get_pulls": _fetch_get_pulls,
    "get_file": _fetch_get_file,
}


def main() -> None:
    """CLI entry point."""
    parser = argparse.ArgumentParser(description="Fetch data from GitHub")
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
