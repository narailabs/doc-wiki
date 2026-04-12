#!/usr/bin/env python3
from __future__ import annotations

"""AWS data fetcher for the wiki-aws-agent.

Library usage:
    from aws_query import fetch
    result = fetch("list_functions", {"region": "us-east-1"})

CLI usage:
    python aws_query.py --action list_functions --params '{"region": "us-east-1"}'
    python aws_query.py --action describe_db --params '{"region": "us-east-1", "db_identifier": "acme-rds"}'
    python aws_query.py --action list_buckets --params '{"prefix": "acme-"}'
    python aws_query.py --action get_metrics --params '{"region": "us-east-1", "namespace": "AWS/Lambda", "metric_name": "Errors"}'
"""

import argparse
import json
import re
import sys
from typing import Any

VALID_ACTIONS = {"list_functions", "describe_db", "list_buckets", "get_metrics"}

MAX_RESULTS_DEFAULT = 50
MAX_RESULTS_CAP = 1000
MAX_METRIC_HOURS = 168  # 7 days

REGION_PATTERN = re.compile(r"^[a-z]{2}-[a-z]+-\d+$")
DB_IDENTIFIER_PATTERN = re.compile(r"^[a-zA-Z][a-zA-Z0-9-]{0,62}$")


def _validate_region(region: str) -> str:
    """Validate AWS region format."""
    if not REGION_PATTERN.match(region):
        raise ValueError(
            f"Invalid region '{region}' — expected format like us-east-1"
        )
    return region


def _validate_list_functions(params: dict[str, Any]) -> dict[str, Any]:
    """Validate params for list_functions action."""
    region = _validate_region(params.get("region", ""))
    prefix = params.get("prefix", "")
    return {"region": region, "prefix": prefix}


def _validate_describe_db(params: dict[str, Any]) -> dict[str, Any]:
    """Validate params for describe_db action."""
    region = _validate_region(params.get("region", ""))
    db_identifier = params.get("db_identifier", "")
    if not DB_IDENTIFIER_PATTERN.match(db_identifier):
        raise ValueError(
            f"Invalid db_identifier '{db_identifier}' — must start with letter, alphanumeric and hyphens only"
        )
    return {"region": region, "db_identifier": db_identifier}


def _validate_list_buckets(params: dict[str, Any]) -> dict[str, Any]:
    """Validate params for list_buckets action."""
    prefix = params.get("prefix", "")
    return {"prefix": prefix}


def _validate_get_metrics(params: dict[str, Any]) -> dict[str, Any]:
    """Validate params for get_metrics action."""
    region = _validate_region(params.get("region", ""))
    namespace = params.get("namespace", "")
    if not namespace or not isinstance(namespace, str):
        raise ValueError("get_metrics requires a non-empty 'namespace' string")
    metric_name = params.get("metric_name", "")
    if not metric_name or not isinstance(metric_name, str):
        raise ValueError("get_metrics requires a non-empty 'metric_name' string")
    dimensions = params.get("dimensions", {})
    if not isinstance(dimensions, dict):
        raise ValueError("'dimensions' must be a dict of key-value pairs")
    hours = min(int(params.get("hours", 24)), MAX_METRIC_HOURS)
    return {
        "region": region,
        "namespace": namespace,
        "metric_name": metric_name,
        "dimensions": dimensions,
        "hours": hours,
    }


_VALIDATORS = {
    "list_functions": _validate_list_functions,
    "describe_db": _validate_describe_db,
    "list_buckets": _validate_list_buckets,
    "get_metrics": _validate_get_metrics,
}


def fetch(action: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
    """Fetch data from AWS.

    Args:
        action: One of list_functions, describe_db, list_buckets, get_metrics.
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
            "message": f"AWS API call failed: {exc}",
        }


def _fetch_list_functions(validated: dict[str, Any]) -> dict[str, Any]:
    """List Lambda functions."""
    # PLACEHOLDER: actual AWS API call
    # import boto3
    # client = boto3.client("lambda", region_name=validated["region"])
    # response = client.list_functions()
    return {
        "status": "success",
        "action": "list_functions",
        "data": {
            "region": validated["region"],
            "functions": [],
            "function_count": 0,
        },
    }


def _fetch_describe_db(validated: dict[str, Any]) -> dict[str, Any]:
    """Describe an RDS instance."""
    # PLACEHOLDER: actual AWS API call
    # import boto3
    # client = boto3.client("rds", region_name=validated["region"])
    # response = client.describe_db_instances(DBInstanceIdentifier=validated["db_identifier"])
    return {
        "status": "success",
        "action": "describe_db",
        "data": {
            "region": validated["region"],
            "db_identifier": validated["db_identifier"],
            "engine": "",
            "engine_version": "",
            "instance_class": "",
            "status": "",
            "endpoint": "",
            "storage_gb": 0,
        },
    }


def _fetch_list_buckets(validated: dict[str, Any]) -> dict[str, Any]:
    """List S3 buckets."""
    # PLACEHOLDER: actual AWS API call
    # import boto3
    # client = boto3.client("s3")
    # response = client.list_buckets()
    return {
        "status": "success",
        "action": "list_buckets",
        "data": {
            "buckets": [],
            "bucket_count": 0,
        },
    }


def _fetch_get_metrics(validated: dict[str, Any]) -> dict[str, Any]:
    """Get CloudWatch metrics."""
    # PLACEHOLDER: actual AWS API call
    # import boto3
    # client = boto3.client("cloudwatch", region_name=validated["region"])
    # response = client.get_metric_statistics(...)
    return {
        "status": "success",
        "action": "get_metrics",
        "data": {
            "region": validated["region"],
            "namespace": validated["namespace"],
            "metric_name": validated["metric_name"],
            "dimensions": validated["dimensions"],
            "hours": validated["hours"],
            "datapoints": [],
        },
    }


_HANDLERS = {
    "list_functions": _fetch_list_functions,
    "describe_db": _fetch_describe_db,
    "list_buckets": _fetch_list_buckets,
    "get_metrics": _fetch_get_metrics,
}


def main() -> None:
    """CLI entry point."""
    parser = argparse.ArgumentParser(description="Query AWS resources")
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
