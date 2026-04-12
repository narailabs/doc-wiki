"""Audit logging for wiki_db -- JSONL format, non-failing."""
from __future__ import annotations

import datetime
import json
import os
import secrets
from typing import Any, Dict, Optional

# Module-level state
_enabled: bool = False
_audit_path: Optional[str] = None
_session_id: Optional[str] = None


def enable_audit(path: str, session_id: Optional[str] = None) -> None:
    """Enable audit logging to *path* (JSONL file).

    If *session_id* is not provided, a random 12-char hex string is generated.
    """
    global _enabled, _audit_path, _session_id
    _enabled = True
    _audit_path = path
    _session_id = session_id if session_id is not None else secrets.token_hex(6)


def disable_audit() -> None:
    """Disable audit logging and clear state."""
    global _enabled, _audit_path, _session_id
    _enabled = False
    _audit_path = None
    _session_id = None


def _write_record(record: Dict[str, Any]) -> None:
    """Append a JSON record to the audit file. Never raises."""
    if not _enabled or _audit_path is None:
        return
    try:
        with open(_audit_path, "a") as fh:
            fh.write(json.dumps(record))
            fh.write("\n")
    except OSError:
        pass


def log_query(
    *,
    env: str,
    query: str,
    status: str,
    row_count: int,
    execution_time_ms: int,
    error: Optional[str] = None,
    context: Optional[str] = None,
) -> None:
    """Log a query execution event."""
    record: Dict[str, Any] = {
        "event_type": "query",
        "timestamp": datetime.datetime.utcnow().isoformat() + "Z",
        "session_id": _session_id,
        "env": env,
        "query": query[:2000],
        "status": status,
        "row_count": row_count,
        "execution_time_ms": execution_time_ms,
    }
    if error is not None:
        record["error"] = error
    if context is not None:
        record["context"] = context
    _write_record(record)


def log_event(
    *,
    event_type: str,
    details: Optional[Dict[str, Any]] = None,
) -> None:
    """Log a non-query event (e.g. connect, schema_inspect)."""
    record: Dict[str, Any] = {
        "event_type": event_type,
        "timestamp": datetime.datetime.utcnow().isoformat() + "Z",
        "session_id": _session_id,
    }
    if details is not None:
        record["details"] = details
    _write_record(record)
