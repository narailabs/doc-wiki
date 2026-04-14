/**
 * policy.ts — Guard-rail mechanism for SQL query authorization.
 *
 * Classifies SQL statements and enforces approval policies before execution.
 *
 * Parity notes vs. the Python reference (`policy.py`):
 *  - `Decision` is a string-literal union (not an enum) so JSON output is the
 *    lowercase wire value directly: `"allow" | "deny" | "escalate" |
 *    "present_only"`. Python's `Enum` values serialize the same.
 *  - `PolicyResult` is a discriminated union on `decision`; `formatted_sql`
 *    exists ONLY on the `present_only` branch, matching Python's behaviour
 *    where the field is populated just for DML.
 *  - Default-deny on unknown first-words: the classifier falls through to
 *    `"ddl"` (the most restrictive category) for anything not in the known
 *    keyword sets, matching `policy.py`.
 */
import { performance } from "node:perf_hooks";
import { pythonJsonDumps } from "../../../skills/wiki/scripts/_json_py.js";
/** Namespace providing Python-style attribute access (`Decision.ALLOW`). */
export const Decision = {
    ALLOW: "allow",
    DENY: "deny",
    ESCALATE: "escalate",
    PRESENT_ONLY: "present_only",
};
/** Namespace mirroring Python's `OperationType.READ` etc. */
export const OperationType = {
    READ: "read",
    DML: "dml",
    DDL: "ddl",
    PRIVILEGE: "privilege",
};
// -----------------------------------------------------------------------
// Keyword -> OperationType mapping
// -----------------------------------------------------------------------
const _READ_KEYWORDS = new Set([
    "SELECT", "EXPLAIN", "SHOW", "DESCRIBE", "DESC", "WITH",
]);
const _DML_KEYWORDS = new Set([
    "INSERT", "UPDATE", "DELETE", "REPLACE", "MERGE", "UPSERT",
]);
const _DDL_KEYWORDS = new Set([
    "CREATE", "DROP", "ALTER", "TRUNCATE", "RENAME",
]);
const _PRIVILEGE_KEYWORDS = new Set([
    "GRANT", "REVOKE",
]);
// Regex to strip SQL line comments (-- ...) and block comments (/* ... */)
const _LINE_COMMENT_RE = /--[^\n]*/g;
// Python uses re.DOTALL so `.` matches newlines; in JS use the `s` flag.
const _BLOCK_COMMENT_RE = /\/\*.*?\*\//gs;
/**
 * Heuristic: a SELECT is "unbounded" if it reads from a table but has
 * no WHERE, LIMIT, JOIN, or specific id filter.
 *
 * Python uses `re.IGNORECASE | re.DOTALL`; in JS we emulate with `is` flags.
 */
const _UNBOUNDED_RE = /^\s*SELECT\s+.*\bFROM\s+\w+/is;
const _BOUNDED_KEYWORDS_RE = /\b(WHERE|LIMIT|OFFSET|JOIN|HAVING|GROUP\s+BY)\b/i;
const _VALID_APPROVAL_MODES = new Set([
    "auto", "confirm_once", "confirm_each", "grant_required",
]);
/**
 * Stateful policy engine that gates SQL execution.
 *
 * Parameters
 * ----------
 * approvalMode : string
 *     One of: auto, confirm_once, confirm_each, grant_required.
 */
export class Policy {
    _approval_mode;
    _session_approved;
    _grants; // grant_type -> expiry (ms, performance.now())
    constructor(approvalMode = "auto") {
        if (!_VALID_APPROVAL_MODES.has(approvalMode)) {
            // Match Python repr(): single-quoted string.
            throw new Error(`Unknown approval_mode: '${approvalMode}'`);
        }
        this._approval_mode = approvalMode;
        this._session_approved = false;
        this._grants = new Map();
    }
    // ------------------------------------------------------------------
    // SQL classification
    // ------------------------------------------------------------------
    /** Remove SQL comments from the statement. */
    static _stripComments(sql) {
        let s = sql.replace(_BLOCK_COMMENT_RE, "");
        s = s.replace(_LINE_COMMENT_RE, "");
        return s.trim();
    }
    /** Determine the OperationType of a raw SQL string. */
    classifySql(sql) {
        const cleaned = Policy._stripComments(sql).trim();
        if (!cleaned) {
            throw new Error("Empty SQL statement");
        }
        // Python: first_word = cleaned.split()[0].upper()
        // str.split() with no argument splits on any whitespace run.
        const firstToken = cleaned.split(/\s+/)[0] ?? "";
        const firstWord = firstToken.toUpperCase();
        if (_PRIVILEGE_KEYWORDS.has(firstWord))
            return OperationType.PRIVILEGE;
        if (_DDL_KEYWORDS.has(firstWord))
            return OperationType.DDL;
        if (_DML_KEYWORDS.has(firstWord))
            return OperationType.DML;
        if (_READ_KEYWORDS.has(firstWord))
            return OperationType.READ;
        // Default: treat unknown statements as DDL (safest)
        return OperationType.DDL;
    }
    // ------------------------------------------------------------------
    // Unbounded query heuristic
    // ------------------------------------------------------------------
    /** Return true if the SELECT appears to lack a bounding clause. */
    static _isUnboundedSelect(sql) {
        if (!_UNBOUNDED_RE.test(sql))
            return false;
        return !_BOUNDED_KEYWORDS_RE.test(sql);
    }
    // ------------------------------------------------------------------
    // Decision logic
    // ------------------------------------------------------------------
    /** Evaluate whether `sql` should be executed under current policy. */
    checkQuery(sql) {
        const stripped = sql.trim();
        if (!stripped) {
            return { decision: "deny", reason: "Empty SQL statement" };
        }
        let op;
        try {
            op = this.classifySql(stripped);
        }
        catch (exc) {
            return { decision: "deny", reason: exc.message };
        }
        // ----- DDL: always denied -----
        if (op === OperationType.DDL) {
            return {
                decision: "deny",
                reason: "DDL statements are never allowed",
            };
        }
        // ----- PRIVILEGE: always denied -----
        if (op === OperationType.PRIVILEGE) {
            return {
                decision: "deny",
                reason: "PRIVILEGE statements are never allowed",
            };
        }
        // ----- DML: present only (show the SQL, do not execute) -----
        if (op === OperationType.DML) {
            let formatted = Policy._stripComments(stripped);
            // Capitalize the first keyword for readability.
            // Python: parts = formatted.split(None, 1)
            //   → splits on ANY whitespace run, at most twice → 1-2 elements.
            const parts = formatted.split(/\s+/);
            const first = parts[0];
            if (first !== undefined) {
                if (parts.length > 1) {
                    const rest = parts.slice(1).join(" ");
                    formatted = first.toUpperCase() + " " + rest;
                }
                else {
                    formatted = first.toUpperCase();
                }
            }
            return {
                decision: "present_only",
                reason: "DML statements are displayed but not executed",
                formatted_sql: formatted,
            };
        }
        // ----- READ: depends on approval mode -----
        return this._checkRead(stripped);
    }
    /** Apply approval-mode logic for READ operations. */
    _checkRead(sql) {
        // Unbounded safety check (applies in all modes)
        if (Policy._isUnboundedSelect(sql)) {
            return {
                decision: "escalate",
                reason: "Unbounded SELECT detected -- add WHERE or LIMIT",
            };
        }
        const mode = this._approval_mode;
        if (mode === "auto") {
            return { decision: "allow", reason: "auto-approved" };
        }
        if (mode === "confirm_once") {
            if (this._session_approved) {
                return { decision: "allow", reason: "session approved" };
            }
            return {
                decision: "escalate",
                reason: "First read requires confirmation (confirm_once)",
            };
        }
        if (mode === "confirm_each") {
            return {
                decision: "escalate",
                reason: "Each read requires confirmation (confirm_each)",
            };
        }
        if (mode === "grant_required") {
            if (this.isGrantActive("read")) {
                return { decision: "allow", reason: "active read grant" };
            }
            return { decision: "deny", reason: "No active read grant" };
        }
        // Unreachable given the constructor guard, but defensive:
        return { decision: "deny", reason: `Unknown mode: ${mode}` };
    }
    // ------------------------------------------------------------------
    // Session & grant management
    // ------------------------------------------------------------------
    /** Mark the current session as approved (for confirm_once mode). */
    approveSession() {
        this._session_approved = true;
    }
    /** Add a time-limited grant. */
    addGrant(grantType, ttlSeconds = 300) {
        this._grants.set(grantType, performance.now() + ttlSeconds * 1000);
    }
    /** Check whether a grant is currently active (not expired). */
    isGrantActive(grantType) {
        const expiry = this._grants.get(grantType);
        if (expiry === undefined)
            return false;
        return performance.now() < expiry;
    }
    // ------------------------------------------------------------------
    // Python-snake_case aliases (for call-site parity with the Python API)
    // ------------------------------------------------------------------
    /** Python alias — identical to {@link checkQuery}. */
    check_query(sql) {
        return this.checkQuery(sql);
    }
    /** Python alias — identical to {@link classifySql}. */
    classify_sql(sql) {
        return this.classifySql(sql);
    }
    /** Python alias — identical to {@link approveSession}. */
    approve_session() {
        this.approveSession();
    }
    /** Python alias — identical to {@link addGrant}. */
    add_grant(grantType, ttlSeconds = 300) {
        this.addGrant(grantType, ttlSeconds);
    }
    /** Python alias — identical to {@link isGrantActive}. */
    is_grant_active(grantType) {
        return this.isGrantActive(grantType);
    }
}
/**
 * Issue a time-limited grant whose TTL derives from an environment's
 * `grant_duration_hours` field (v2 design §4 default: 8 hours).
 *
 * This is the recommended API for prod callers — `addGrant` remains the
 * low-level primitive (5-minute default, used for short-lived operations
 * like test scaffolding and administrative confirmations).
 */
export function grantFromEnv(policy, env, grantType) {
    const hours = env.grant_duration_hours ?? 8;
    policy.addGrant(grantType, hours * 3600);
}
/**
 * Serialize a PolicyResult to Python-compatible JSON.
 *
 * Key order matches Python's dataclass-to-dict field order:
 *   decision, reason, (formatted_sql only when present).
 *
 * Use {@link pythonJsonDumps} so separators are ", " and ": " exactly.
 */
export function policyResultJson(result) {
    // Explicitly construct the object literal so key ordering is deterministic
    // (V8 preserves string-key insertion order).
    if (result.decision === "present_only") {
        return pythonJsonDumps({
            decision: result.decision,
            reason: result.reason,
            formatted_sql: result.formatted_sql,
        });
    }
    return pythonJsonDumps({
        decision: result.decision,
        reason: result.reason,
    });
}
