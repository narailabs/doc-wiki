"""policy.py -- Guard-rail mechanism for SQL query authorization.

Classifies SQL statements and enforces approval policies before execution.
"""
from __future__ import annotations

import re
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Dict, Optional


class Decision(Enum):
    """Possible outcomes of a policy check."""
    ALLOW = "allow"
    DENY = "deny"
    ESCALATE = "escalate"
    PRESENT_ONLY = "present_only"


class OperationType(Enum):
    """Classification of SQL statements by intent."""
    READ = "read"
    DML = "dml"
    DDL = "ddl"
    PRIVILEGE = "privilege"


@dataclass
class PolicyResult:
    """Result of a policy check on a SQL statement."""
    decision: Decision
    reason: str
    formatted_sql: Optional[str] = None


# -----------------------------------------------------------------------
# Keyword -> OperationType mapping
# -----------------------------------------------------------------------

_READ_KEYWORDS = frozenset({"SELECT", "EXPLAIN", "SHOW", "DESCRIBE", "DESC", "WITH"})
_DML_KEYWORDS = frozenset({"INSERT", "UPDATE", "DELETE", "REPLACE", "MERGE", "UPSERT"})
_DDL_KEYWORDS = frozenset({"CREATE", "DROP", "ALTER", "TRUNCATE", "RENAME"})
_PRIVILEGE_KEYWORDS = frozenset({"GRANT", "REVOKE"})

# Regex to strip SQL line comments (-- ...) and block comments (/* ... */)
_LINE_COMMENT_RE = re.compile(r"--[^\n]*")
_BLOCK_COMMENT_RE = re.compile(r"/\*.*?\*/", re.DOTALL)

# Heuristic: a SELECT is "unbounded" if it reads from a table but has
# no WHERE, LIMIT, JOIN, or specific id filter.
_UNBOUNDED_RE = re.compile(
    r"^\s*SELECT\s+.*\bFROM\s+\w+",
    re.IGNORECASE | re.DOTALL,
)
_BOUNDED_KEYWORDS_RE = re.compile(
    r"\b(WHERE|LIMIT|OFFSET|JOIN|HAVING|GROUP\s+BY)\b",
    re.IGNORECASE,
)


class Policy:
    """Stateful policy engine that gates SQL execution.

    Parameters
    ----------
    approval_mode : str
        One of: auto, confirm_once, confirm_each, grant_required.
    """

    def __init__(self, approval_mode: str = "auto") -> None:
        if approval_mode not in ("auto", "confirm_once", "confirm_each", "grant_required"):
            raise ValueError(f"Unknown approval_mode: {approval_mode!r}")
        self._approval_mode = approval_mode
        self._session_approved = False
        self._grants: Dict[str, float] = {}  # grant_type -> expiry timestamp

    # ------------------------------------------------------------------
    # SQL classification
    # ------------------------------------------------------------------

    @staticmethod
    def _strip_comments(sql: str) -> str:
        """Remove SQL comments from the statement."""
        sql = _BLOCK_COMMENT_RE.sub("", sql)
        sql = _LINE_COMMENT_RE.sub("", sql)
        return sql.strip()

    def classify_sql(self, sql: str) -> OperationType:
        """Determine the OperationType of a raw SQL string."""
        cleaned = self._strip_comments(sql).strip()
        if not cleaned:
            raise ValueError("Empty SQL statement")

        first_word = cleaned.split()[0].upper()

        if first_word in _PRIVILEGE_KEYWORDS:
            return OperationType.PRIVILEGE
        if first_word in _DDL_KEYWORDS:
            return OperationType.DDL
        if first_word in _DML_KEYWORDS:
            return OperationType.DML
        if first_word in _READ_KEYWORDS:
            return OperationType.READ

        # Default: treat unknown statements as DDL (safest)
        return OperationType.DDL

    # ------------------------------------------------------------------
    # Unbounded query heuristic
    # ------------------------------------------------------------------

    @staticmethod
    def _is_unbounded_select(sql: str) -> bool:
        """Return True if the SELECT appears to lack a bounding clause."""
        if not _UNBOUNDED_RE.search(sql):
            return False
        return not _BOUNDED_KEYWORDS_RE.search(sql)

    # ------------------------------------------------------------------
    # Decision logic
    # ------------------------------------------------------------------

    def check_query(self, sql: str) -> PolicyResult:
        """Evaluate whether *sql* should be executed under current policy."""
        stripped = sql.strip()
        if not stripped:
            return PolicyResult(
                decision=Decision.DENY,
                reason="Empty SQL statement",
            )

        try:
            op = self.classify_sql(stripped)
        except ValueError as exc:
            return PolicyResult(decision=Decision.DENY, reason=str(exc))

        # ----- DDL: always denied -----
        if op == OperationType.DDL:
            return PolicyResult(
                decision=Decision.DENY,
                reason="DDL statements are never allowed",
            )

        # ----- PRIVILEGE: always denied -----
        if op == OperationType.PRIVILEGE:
            return PolicyResult(
                decision=Decision.DENY,
                reason="PRIVILEGE statements are never allowed",
            )

        # ----- DML: present only (show the SQL, do not execute) -----
        if op == OperationType.DML:
            formatted = self._strip_comments(stripped)
            # Capitalize the first keyword for readability
            parts = formatted.split(None, 1)
            if parts:
                formatted = parts[0].upper() + (" " + parts[1] if len(parts) > 1 else "")
            return PolicyResult(
                decision=Decision.PRESENT_ONLY,
                reason="DML statements are displayed but not executed",
                formatted_sql=formatted,
            )

        # ----- READ: depends on approval mode -----
        return self._check_read(stripped)

    def _check_read(self, sql: str) -> PolicyResult:
        """Apply approval-mode logic for READ operations."""
        # Unbounded safety check (applies in all modes)
        if self._is_unbounded_select(sql):
            return PolicyResult(
                decision=Decision.ESCALATE,
                reason="Unbounded SELECT detected -- add WHERE or LIMIT",
            )

        mode = self._approval_mode

        if mode == "auto":
            return PolicyResult(decision=Decision.ALLOW, reason="auto-approved")

        if mode == "confirm_once":
            if self._session_approved:
                return PolicyResult(decision=Decision.ALLOW, reason="session approved")
            return PolicyResult(
                decision=Decision.ESCALATE,
                reason="First read requires confirmation (confirm_once)",
            )

        if mode == "confirm_each":
            return PolicyResult(
                decision=Decision.ESCALATE,
                reason="Each read requires confirmation (confirm_each)",
            )

        if mode == "grant_required":
            if self.is_grant_active("read"):
                return PolicyResult(decision=Decision.ALLOW, reason="active read grant")
            return PolicyResult(
                decision=Decision.DENY,
                reason="No active read grant",
            )

        return PolicyResult(decision=Decision.DENY, reason=f"Unknown mode: {mode}")

    # ------------------------------------------------------------------
    # Session & grant management
    # ------------------------------------------------------------------

    def approve_session(self) -> None:
        """Mark the current session as approved (for confirm_once mode)."""
        self._session_approved = True

    def add_grant(self, grant_type: str, ttl_seconds: int = 300) -> None:
        """Add a time-limited grant."""
        self._grants[grant_type] = time.monotonic() + ttl_seconds

    def is_grant_active(self, grant_type: str) -> bool:
        """Check whether a grant is currently active (not expired)."""
        expiry = self._grants.get(grant_type)
        if expiry is None:
            return False
        return time.monotonic() < expiry
