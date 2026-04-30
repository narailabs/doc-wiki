/**
 * db_provider.ts — Database provider interface for ORM cross-validation.
 *
 * Decouples the ORM extractor from wiki_db. Callers inject a DbProvider
 * into crossValidate() instead of the extractor importing wiki_db directly.
 */

/** Column shape used by cross-validation (plain data, no methods). */
export interface DbColumn {
  name: string;
  data_type: string;
  nullable: boolean;
  is_primary_key: boolean;
  default: string | null;
}

/** Table shape used by cross-validation (plain data, no methods). */
export interface DbTable {
  name: string;
  schema: string;
  columns: DbColumn[];
}

/**
 * Abstraction over database schema introspection for cross-validation.
 *
 * Implementations connect to a named environment, query the schema, and
 * return plain Table objects. The ORM extractor only needs table/column
 * names for diffing — it never executes arbitrary SQL through this
 * interface.
 */
export interface DbProvider {
  getSchema(envName: string, tableFilter?: string | null): Promise<DbTable[]>;
}
