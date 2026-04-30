/**
 * drivers/register.ts — Register every Phase E driver factory with the
 * connection-pool registry shipped in `connection.ts`.
 *
 * `registerAll()` is idempotent: calling it a second time overwrites the
 * factories for the same driver names, which is fine because factories
 * are stateless (they instantiate a fresh driver per environment).
 *
 * Callers:
 *  - `wiki_db/index.ts` re-exports this module and invokes `registerAll()`
 *    at import time, so any consumer that does
 *       `import { getConnection } from "wiki_db"`
 *    gets all drivers registered before they try to open a connection.
 */
import { registerDriverFactory } from "../connection.js";
import { PostgresDriver } from "./postgresql.js";
import { MysqlDriver } from "./mysql.js";
import { SqlServerDriver } from "./sqlserver.js";
import { MongoDriver } from "./mongodb.js";
import { DynamoDriver } from "./dynamodb.js";
/**
 * Register every Phase E driver factory. Safe to call multiple times.
 *
 * Driver names match the values used in `wiki.config.yaml → environments.<name>.driver`.
 */
export function registerAll() {
    registerDriverFactory("postgresql", () => new PostgresDriver());
    registerDriverFactory("postgres", () => new PostgresDriver()); // alias
    registerDriverFactory("mysql", () => new MysqlDriver());
    registerDriverFactory("sqlserver", () => new SqlServerDriver());
    registerDriverFactory("mssql", () => new SqlServerDriver()); // alias
    registerDriverFactory("mongodb", () => new MongoDriver());
    registerDriverFactory("mongo", () => new MongoDriver()); // alias
    registerDriverFactory("dynamodb", () => new DynamoDriver());
    registerDriverFactory("dynamo", () => new DynamoDriver()); // alias
}
