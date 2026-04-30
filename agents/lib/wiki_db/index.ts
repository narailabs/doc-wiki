/**
 * wiki_db — shared library for safe database access.
 *
 * Public API mirrors `agents/lib/wiki_db/__init__.py`:
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
export * from "./connection.js";

// Drivers
export * from "./drivers/base.js";
export { SQLiteDriver } from "./drivers/sqlite.js";
export { PostgresDriver } from "./drivers/postgresql.js";
export { MysqlDriver } from "./drivers/mysql.js";
export { SqlServerDriver } from "./drivers/sqlserver.js";
export { MongoDriver } from "./drivers/mongodb.js";
export { DynamoDriver } from "./drivers/dynamodb.js";
export { registerAll as registerAllDrivers } from "./drivers/register.js";

// Side-effect: register every Phase E driver factory with the connection
// pool registry so `getConnection("<envName>")` works for any configured
// driver out of the box.
import { registerAll as _registerAllDrivers } from "./drivers/register.js";
_registerAllDrivers();
