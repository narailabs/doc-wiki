/**
 * wiki_db — shared library for safe database access.
 *
 * Public API mirrors `.claude/agents/lib/wiki_db/__init__.py`:
 *   import { executeQuery, enableAudit, disableAudit } from "wiki_db";
 *   import { Policy, Decision, checkQuery } from "wiki_db/policy";
 *   import { getEnvironment, listEnvironments } from "wiki_db/environments";
 */
// Core
export * from "./policy.js";
export * from "./query.js";
export * from "./environments.js";
export * from "./audit.js";
export * from "./credentials.js";
export * from "./schema.js";
// Drivers
export * from "./drivers/base.js";
export { SQLiteDriver } from "./drivers/sqlite.js";
