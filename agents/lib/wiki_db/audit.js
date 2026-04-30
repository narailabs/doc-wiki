/**
 * audit.ts — re-export of `narai-primitives/db`'s audit primitives.
 *
 * The local copy was byte-identical to upstream; this shim collapses it
 * onto the canonical declarations. Single source of truth lives in the
 * published connector package.
 */
export { enableAudit, disableAudit, scrubSqlSecrets, logQuery, logEvent, _auditState, } from "narai-primitives/db";
