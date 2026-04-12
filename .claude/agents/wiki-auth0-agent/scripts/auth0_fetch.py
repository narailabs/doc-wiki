#!/usr/bin/env python3
from __future__ import annotations

"""Auth0 data fetcher for the wiki-auth0-agent.

Library usage:
    from auth0_fetch import fetch
    result = fetch("get_clients", {"max_results": 50})

CLI usage:
    python auth0_fetch.py --action get_clients --params '{"max_results": 50}'
    python auth0_fetch.py --action get_connections --params '{"strategy": "auth0"}'
    python auth0_fetch.py --action get_rules --params '{"enabled": true}'
    python auth0_fetch.py --action get_users --params '{"q": "email:*@acme.com"}'
"""

import argparse
import json
import re
import sys
from typing import Any

VALID_ACTIONS = {"get_clients", "get_connections", "get_rules", "get_users"}

MAX_RESULTS_DEFAULT = 50
MAX_RESULTS_CAP = 100

# Fields that must be redacted in output
REDACTED_FIELDS = {"client_secret", "signing_keys", "password", "access_token", "refresh_token"}


def _redact_secrets(data: dict[str, Any]) -> dict[str, Any]:
    """Redact sensitive fields from response data."""
    redacted = {}
    for key, value in data.items():
        if key in REDACTED_FIELDS:
            redacted[key] = "***REDACTED***"
        elif isinstance(value, dict):
            redacted[key] = _redact_secrets(value)
        elif isinstance(value, list):
            redacted[key] = [
                _redact_secrets(item) if isinstance(item, dict) else item
                for item in value
            ]
        else:
            redacted[key] = value
    return redacted


def _validate_get_clients(params: dict[str, Any]) -> dict[str, Any]:
    """Validate params for get_clients action."""
    max_results = min(
        int(params.get("max_results", MAX_RESULTS_DEFAULT)),
        MAX_RESULTS_CAP,
    )
    return {"max_results": max_results}


def _validate_get_connections(params: dict[str, Any]) -> dict[str, Any]:
    """Validate params for get_connections action."""
    strategy = params.get("strategy", "")
    valid_strategies = {"auth0", "google-oauth2", "facebook", "github", "samlp", "oidc", "waad", ""}
    if strategy and strategy not in valid_strategies:
        raise ValueError(
            f"Invalid strategy '{strategy}' — expected one of {sorted(valid_strategies - {''})}"
        )
    return {"strategy": strategy}


def _validate_get_rules(params: dict[str, Any]) -> dict[str, Any]:
    """Validate params for get_rules action."""
    enabled = params.get("enabled")
    if enabled is not None and not isinstance(enabled, bool):
        raise ValueError("'enabled' must be a boolean or null")
    return {"enabled": enabled}


def _validate_get_users(params: dict[str, Any]) -> dict[str, Any]:
    """Validate params for get_users action."""
    query = params.get("q", "")
    if not query or not isinstance(query, str):
        raise ValueError("get_users requires a non-empty 'q' string")
    # Prevent injection in Lucene query
    if any(c in query for c in [";", "'", '"', "\\"]):
        raise ValueError("Query contains forbidden characters")
    search_engine = params.get("search_engine", "v3")
    if search_engine not in {"v3"}:
        raise ValueError("Only search_engine 'v3' is supported")
    max_results = min(
        int(params.get("max_results", MAX_RESULTS_DEFAULT)),
        MAX_RESULTS_CAP,
    )
    return {"q": query.strip(), "search_engine": search_engine, "max_results": max_results}


_VALIDATORS = {
    "get_clients": _validate_get_clients,
    "get_connections": _validate_get_connections,
    "get_rules": _validate_get_rules,
    "get_users": _validate_get_users,
}


def fetch(action: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
    """Fetch data from Auth0.

    Args:
        action: One of get_clients, get_connections, get_rules, get_users.
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
            "message": f"Auth0 API call failed: {exc}",
        }


def _fetch_get_clients(validated: dict[str, Any]) -> dict[str, Any]:
    """Fetch Auth0 clients (applications)."""
    # PLACEHOLDER: actual Auth0 Management API call
    # response = requests.get(
    #     f"https://{domain}/api/v2/clients",
    #     headers={"Authorization": f"Bearer {token}"},
    #     params={"per_page": validated["max_results"]},
    #     timeout=30,
    # )
    return {
        "status": "success",
        "action": "get_clients",
        "data": {
            "total": 0,
            "clients": [],
        },
    }


def _fetch_get_connections(validated: dict[str, Any]) -> dict[str, Any]:
    """Fetch Auth0 connections."""
    # PLACEHOLDER: actual Auth0 Management API call
    # response = requests.get(
    #     f"https://{domain}/api/v2/connections",
    #     headers={"Authorization": f"Bearer {token}"},
    #     params={"strategy": validated["strategy"]} if validated["strategy"] else {},
    #     timeout=30,
    # )
    return {
        "status": "success",
        "action": "get_connections",
        "data": {
            "total": 0,
            "connections": [],
        },
    }


def _fetch_get_rules(validated: dict[str, Any]) -> dict[str, Any]:
    """Fetch Auth0 rules/actions."""
    # PLACEHOLDER: actual Auth0 Management API call
    # response = requests.get(
    #     f"https://{domain}/api/v2/rules",
    #     headers={"Authorization": f"Bearer {token}"},
    #     params={"enabled": str(validated["enabled"]).lower()} if validated["enabled"] is not None else {},
    #     timeout=30,
    # )
    return {
        "status": "success",
        "action": "get_rules",
        "data": {
            "total": 0,
            "rules": [],
        },
    }


def _fetch_get_users(validated: dict[str, Any]) -> dict[str, Any]:
    """Fetch Auth0 users."""
    # PLACEHOLDER: actual Auth0 Management API call
    # response = requests.get(
    #     f"https://{domain}/api/v2/users",
    #     headers={"Authorization": f"Bearer {token}"},
    #     params={"q": validated["q"], "search_engine": validated["search_engine"]},
    #     timeout=30,
    # )
    return {
        "status": "success",
        "action": "get_users",
        "data": {
            "total": 0,
            "users": [],
        },
    }


_HANDLERS = {
    "get_clients": _fetch_get_clients,
    "get_connections": _fetch_get_connections,
    "get_rules": _fetch_get_rules,
    "get_users": _fetch_get_users,
}


def main() -> None:
    """CLI entry point."""
    parser = argparse.ArgumentParser(description="Fetch data from Auth0")
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
