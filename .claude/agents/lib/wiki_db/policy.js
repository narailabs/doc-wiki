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
 *
 * G-DB-1: the SQL keyword classifier is exported as a top-level
 * `classifySqlKeywords` so non-relational drivers (MongoDB, DynamoDB) can
 * provide their own override via the `DatabaseDriver.classifyOperation`
 * method without going through the SQL keyword path. Policy.checkQuery
 * accepts an optional driver and dispatches accordingly.
 */
import { performance } from "node:perf_hooks";
import { logEvent, scrubSqlSecrets } from "./audit.js";
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
/**
 * Classify a SQL string by its leading keyword.
 *
 * Exported so SQL drivers (sqlite, postgres, mysql, mssql) can implement
 * `DatabaseDriver.classifyOperation` without instantiating a Policy. Throws
 * `Error("Empty SQL statement")` for empty/whitespace-only input.
 *
 * Default-deny: any unknown first-word falls through to `DDL` (most
 * restrictive), matching `policy.py`.
 */
export function classifySqlKeywords(sql) {
    const cleaned = Policy._stripComments(sql).trim();
    if (!cleaned) {
        throw new Error("Empty SQL statement");
    }
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
    return OperationType.DDL;
}
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
// G-POLICY-CROSSJOIN: require JOIN ... ON so CROSS JOIN (which has no
// join predicate and explodes rows) does not count as bounded. Bare
// JOIN USING (…) also falls through to escalate — safe direction.
const _BOUNDED_KEYWORDS_RE = /\b(WHERE|LIMIT|OFFSET|HAVING|GROUP\s+BY|JOIN\s+\S+\s+ON)\b/i;
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
    // G-DB-AUDIT: grant_types that have already had a `grant_expired` event
    // emitted (de-dupes spam from repeated isGrantActive polling).
    _expired_logged;
    constructor(approvalMode = "auto") {
        if (!_VALID_APPROVAL_MODES.has(approvalMode)) {
            // Match Python repr(): single-quoted string.
            throw new Error(`Unknown approval_mode: '${approvalMode}'`);
        }
        this._approval_mode = approvalMode;
        this._session_approved = false;
        this._grants = new Map();
        this._expired_logged = new Set();
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
        return classifySqlKeywords(sql);
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
    /**
     * Evaluate whether `sql` should be executed under current policy.
     *
     * G-DB-1: when `driver` is supplied, classification is delegated to
     * `driver.classifyOperation()`. This lets non-relational drivers
     * (MongoDB, DynamoDB) classify their JSON envelope queries instead of
     * falling through SQL keyword matching (which would default to DDL).
     *
     * G-DB-AUDIT: every `deny` decision is emitted as a `policy_deny` event
     * via `audit.logEvent`. The audit module no-ops when audit is disabled.
     */
    checkQuery(sql, driver) {
        const stripped = sql.trim();
        if (!stripped) {
            const result = { decision: "deny", reason: "Empty SQL statement" };
            _emitDeny(result.reason, null);
            return result;
        }
        let op;
        try {
            op = driver !== undefined
                ? driver.classifyOperation(stripped)
                : this.classifySql(stripped);
        }
        catch (exc) {
            const reason = exc.message;
            _emitDeny(reason, null);
            return { decision: "deny", reason };
        }
        // ----- DDL: always denied -----
        if (op === OperationType.DDL) {
            const reason = "DDL statements are never allowed";
            _emitDeny(reason, op);
            return { decision: "deny", reason };
        }
        // ----- PRIVILEGE: always denied -----
        if (op === OperationType.PRIVILEGE) {
            const reason = "PRIVILEGE statements are never allowed";
            _emitDeny(reason, op);
            return { decision: "deny", reason };
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
            _emitPresentOnly("DML statements are displayed but not executed", op, formatted);
            return {
                decision: "present_only",
                reason: "DML statements are displayed but not executed",
                formatted_sql: formatted,
            };
        }
        // ----- READ: depends on approval mode -----
        const result = this._checkRead(stripped);
        if (result.decision === "deny") {
            _emitDeny(result.reason, op);
        }
        return result;
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
    /**
     * Add a time-limited grant.
     *
     * G-DB-AUDIT: emits a `grant_added` event with the grant type and TTL.
     *
     * Lifetime scope: grants are in-process only. Expiry is measured with
     * `performance.now()`, which is reset on every Node process start, so
     * a new CLI invocation always begins with no active grants — even if
     * a previous run added one seconds ago. Suitable for the CLI's
     * single-invocation model; not suitable as a cross-process gate.
     */
    addGrant(grantType, ttlSeconds = 300) {
        // performance.now() is process-relative; see JSDoc for lifetime scope.
        this._grants.set(grantType, performance.now() + ttlSeconds * 1000);
        logEvent({
            event_type: "grant_added",
            details: { grant_type: grantType, ttl_seconds: ttlSeconds },
        });
    }
    /**
     * Check whether a grant is currently active (not expired).
     *
     * G-DB-AUDIT: emits a single `grant_expired` event the first time an
     * expired grant is observed (subsequent checks are silent so the audit
     * log isn't spammed by repeated polling).
     */
    isGrantActive(grantType) {
        const expiry = this._grants.get(grantType);
        if (expiry === undefined)
            return false;
        if (performance.now() < expiry)
            return true;
        if (!this._expired_logged.has(grantType)) {
            this._expired_logged.add(grantType);
            logEvent({
                event_type: "grant_expired",
                details: { grant_type: grantType },
            });
        }
        return false;
    }
}
/**
 * Issue a time-limited grant whose TTL derives from an environment's
 * `grant_duration_hours` field (v2 design §4 default: 8 hours).
 *
 * This is the recommended API for prod callers — `addGrant` remains the
 * low-level primitive (5-minute default, used for short-lived operations
 * like test scaffolding and administrative confirmations).
 *
 * Lifetime scope: grants live in memory only. Because `addGrant` uses
 * `performance.now()` — a process-relative monotonic clock — a grant
 * written in one CLI invocation does NOT carry into the next one, even
 * if `grant_duration_hours=8`. The "8 hour" default means "up to 8
 * wall-clock hours within a single long-running session," not "8
 * wall-clock hours across reboots." Persisting grants to disk is out
 * of scope for v2.
 */
export function grantFromEnv(policy, env, grantType) {
    const hours = env.grant_duration_hours ?? 8;
    policy.addGrant(grantType, hours * 3600);
}
/**
 * G-DB-AUDIT: emit a `policy_deny` event with the deny reason and the
 * SQL operation type (when known). The audit module no-ops when audit
 * has not been enabled, so this is safe to call unconditionally.
 */
function _emitDeny(reason, op) {
    const details = { reason };
    if (op !== null)
        details["op"] = op;
    logEvent({ event_type: "policy_deny", details });
}
/**
 * Symmetric to `_emitDeny`: emit a `policy_present_only` event when a DML
 * statement is intercepted and returned as formatted SQL rather than
 * executed. Without this, the "no write event occurred" audit assertion
 * on PRESENT_ONLY paths passes vacuously — an empty audit log also has
 * no writes. Recording the policy decision gives downstream consumers
 * (and eval graders) a positive signal that the decision actually fired.
 *
 * The `formatted_sql` is truncated to a reasonable length so the audit
 * file doesn't bloat on long INSERTs; the full SQL is already in the
 * API response.
 */
function _emitPresentOnly(reason, op, formattedSql) {
    // Scrub credentials before truncation so a literal split by truncation
    // can't leak. Same helper used by audit.logQuery.
    const scrubbed = scrubSqlSecrets(formattedSql);
    const truncated = scrubbed.length > 500
        ? scrubbed.slice(0, 500) + "\u2026"
        : scrubbed;
    const details = {
        reason,
        formatted_sql: truncated,
    };
    if (op !== null)
        details["op"] = op;
    logEvent({ event_type: "policy_present_only", details });
}
/**
 * Serialize a PolicyResult to JSON.
 *
 * Key order: decision, reason, (formatted_sql only when decision ===
 * "present_only"). V8 preserves string-key insertion order so explicit
 * construction is sufficient.
 */
export function policyResultJson(result) {
    if (result.decision === "present_only") {
        return JSON.stringify({
            decision: result.decision,
            reason: result.reason,
            formatted_sql: result.formatted_sql,
        });
    }
    return JSON.stringify({
        decision: result.decision,
        reason: result.reason,
    });
}
