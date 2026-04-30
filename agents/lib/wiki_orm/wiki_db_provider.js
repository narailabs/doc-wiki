/**
 * wiki_db_provider.ts — Concrete DbProvider backed by wiki_db.
 *
 * Bridges the DbProvider interface to wiki_db's connection pool and
 * SchemaManager. Used by the ORM agent CLI (orm_detect.ts) when --env
 * is supplied and cross-validation is enabled.
 */
import { getConnection, releaseConnection, SchemaManager, } from "../wiki_db/index.js";
export function createDbProvider() {
    return {
        async getSchema(envName, tableFilter = null) {
            const conn = await getConnection(envName);
            try {
                const mgr = new SchemaManager(conn.driver);
                const tables = await mgr.getSchema(conn.native, envName, "", tableFilter);
                // Map class instances to plain objects matching DbTable shape.
                return tables.map((t) => ({
                    name: t.name,
                    schema: t.schema,
                    columns: t.columns.map((c) => ({
                        name: c.name,
                        data_type: c.data_type,
                        nullable: c.nullable,
                        is_primary_key: c.is_primary_key,
                        default: c.default,
                    })),
                }));
            }
            finally {
                releaseConnection(envName, conn);
            }
        },
    };
}
