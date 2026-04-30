/**
 * db_provider.ts — Database provider interface for ORM cross-validation.
 *
 * Decouples the ORM extractor from wiki_db. Callers inject a DbProvider
 * into crossValidate() instead of the extractor importing wiki_db directly.
 */
export {};
