/**
 * wiki_orm — ORM mapper shared library.
 *
 * Public API mirrors `.claude/agents/lib/wiki_orm/__init__.py`:
 *   import { loadProfile, loadAllProfiles, detectOrm } from "wiki_orm";
 *   import { extractEntities } from "wiki_orm/extractor";
 *   import { generateMappingMarkdown } from "wiki_orm/output";
 *
 * The Python `__init__.py` is intentionally empty (no re-exports); the TS
 * barrel is provided for IDE autocomplete and to keep import paths short.
 */
export * from "./profiles.js";
export * from "./extractor.js";
export * from "./output.js";
