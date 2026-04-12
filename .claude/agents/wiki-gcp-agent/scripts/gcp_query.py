#!/usr/bin/env python3
from __future__ import annotations

"""GCP data fetcher for the wiki-gcp-agent.

Library usage:
    from gcp_query import fetch
    result = fetch("list_services", {"project_id": "acme-prod-123"})

CLI usage:
    python gcp_query.py --action list_services --params '{"project_id": "acme-prod-123"}'
    python gcp_query.py --action describe_db --params '{"project_id": "acme-prod-123", "instance_id": "main-pg"}'
    python gcp_query.py --action list_topics --params '{"project_id": "acme-prod-123"}'
    python gcp_query.py --action query_logs --params '{"project_id": "acme-prod-123", "filter": "severity>=ERROR"}'
"""

import argparse
import json
import re
import sys
from typing import Any

VALID_ACTIONS = {"list_services", "describe_db", "list_topics", "query_logs"}

MAX_RESULTS_DEFAULT = 100
MAX_RESULTS_CAP = 1000
MAX_LOG_HOURS = 168  # 7 days

PROJECT_ID_PATTERN = re.compile(r"^[a-z][a-z0-9-]{4,28}[a-z0-9]$")


def _validate_project_id(project_id: str) -> str:
    """Validate GCP project ID format."""
    if not PROJECT_ID_PATTERN.match(project_id):
        raise ValueError(
            f"Invalid project_id '{project_id}' — must be 6-30 lowercase letters, digits, hyphens"
        )
    return project_id


def _validate_list_services(params: dict[str, Any]) -> dict[str, Any]:
    """Validate params for list_services action."""
    project_id = _validate_project_id(params.get("project_id", ""))
    return {"project_id": project_id}


def _validate_describe_db(params: dict[str, Any]) -> dict[str, Any]:
    """Validate params for describe_db action."""
    project_id = _validate_project_id(params.get("project_id", ""))
    instance_id = params.get("instance_id", "")
    if not instance_id or not isinstance(instance_id, str):
        raise ValueError("describe_db requires a non-empty 'instance_id' string")
    database = params.get("database", "")
    return {"project_id": project_id, "instance_id": instance_id, "database": database}


def _validate_list_topics(params: dict[str, Any]) -> dict[str, Any]:
    """Validate params for list_topics action."""
    project_id = _validate_project_id(params.get("project_id", ""))
    return {"project_id": project_id}


def _validate_query_logs(params: dict[str, Any]) -> dict[str, Any]:
    """Validate params for query_logs action."""
    project_id = _validate_project_id(params.get("project_id", ""))
    log_filter = params.get("filter", "")
    if not log_filter or not isinstance(log_filter, str):
        raise ValueError("query_logs requires a non-empty 'filter' string")
    # Basic injection prevention: reject semicolons and quotes
    if ";" in log_filter or "'" in log_filter or '"' in log_filter:
        raise ValueError("Filter contains forbidden characters — no semicolons or quotes allowed")
    hours = min(int(params.get("hours", 24)), MAX_LOG_HOURS)
    max_results = min(
        int(params.get("max_results", MAX_RESULTS_DEFAULT)),
        MAX_RESULTS_CAP,
    )
    return {
        "project_id": project_id,
        "filter": log_filter.strip(),
        "hours": hours,
        "max_results": max_results,
    }


_VALIDATORS = {
    "list_services": _validate_list_services,
    "describe_db": _validate_describe_db,
    "list_topics": _validate_list_topics,
    "query_logs": _validate_query_logs,
}


def fetch(action: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
    """Fetch data from GCP.

    Args:
        action: One of list_services, describe_db, list_topics, query_logs.
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
            "message": f"GCP API call failed: {exc}",
        }


def _fetch_list_services(validated: dict[str, Any]) -> dict[str, Any]:
    """List GCP services in project."""
    # PLACEHOLDER: actual GCP API call
    # from google.cloud import run_v2
    # client = run_v2.ServicesClient()
    # services = client.list_services(parent=f"projects/{validated['project_id']}/locations/-")
    return {
        "status": "success",
        "action": "list_services",
        "data": {
            "project_id": validated["project_id"],
            "services": [],
            "service_count": 0,
        },
    }


def _fetch_describe_db(validated: dict[str, Any]) -> dict[str, Any]:
    """Describe a Cloud SQL instance."""
    # PLACEHOLDER: actual GCP API call
    # from google.cloud import sqladmin_v1
    # client = sqladmin_v1.SqlInstancesServiceClient()
    # instance = client.get(project=validated["project_id"], instance=validated["instance_id"])
    return {
        "status": "success",
        "action": "describe_db",
        "data": {
            "project_id": validated["project_id"],
            "instance_id": validated["instance_id"],
            "database": validated.get("database", ""),
            "engine": "",
            "version": "",
            "tier": "",
            "region": "",
            "state": "",
            "tables": [],
        },
    }


def _fetch_list_topics(validated: dict[str, Any]) -> dict[str, Any]:
    """List Pub/Sub topics in project."""
    # PLACEHOLDER: actual GCP API call
    # from google.cloud import pubsub_v1
    # publisher = pubsub_v1.PublisherClient()
    # topics = publisher.list_topics(project=f"projects/{validated['project_id']}")
    return {
        "status": "success",
        "action": "list_topics",
        "data": {
            "project_id": validated["project_id"],
            "topics": [],
            "topic_count": 0,
        },
    }


def _fetch_query_logs(validated: dict[str, Any]) -> dict[str, Any]:
    """Query Cloud Logging entries."""
    # PLACEHOLDER: actual GCP API call
    # from google.cloud import logging_v2
    # client = logging_v2.Client(project=validated["project_id"])
    # entries = client.list_entries(filter_=validated["filter"], max_results=validated["max_results"])
    return {
        "status": "success",
        "action": "query_logs",
        "data": {
            "project_id": validated["project_id"],
            "filter": validated["filter"],
            "hours": validated["hours"],
            "entries": [],
            "entry_count": 0,
        },
        "truncated": False,
    }


_HANDLERS = {
    "list_services": _fetch_list_services,
    "describe_db": _fetch_describe_db,
    "list_topics": _fetch_list_topics,
    "query_logs": _fetch_query_logs,
}


def main() -> None:
    """CLI entry point."""
    parser = argparse.ArgumentParser(description="Query GCP resources")
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
