/** The exact, fixed prompt both arms receive. The wiki is never mentioned — the wiki arm must discover it via CLAUDE.md like a real agent. */
export function buildPrompt(t) {
    return `${t.title}\n\n${t.body_sanitized}\n\nInvestigate and fix this issue in this repository. Run the relevant tests to check your fix.`;
}
// Matches both straight apostrophe (U+0027) and right single quotation mark (U+2019)
const RATE_LIMIT = /You['’]ve hit your .{0,40}limit[^\n"]*/i;
/**
 * Classify a finished session from its JSON envelope + exit code + stderr.
 * Rate-limit detection is best-effort: anything unrecognized is "error"
 * (re-queued on resume), so a changed message can never corrupt results.
 */
export function classifySession(resultJson, exitCode, stderr) {
    // stderr first: covers the case where claude is killed before writing an envelope.
    const stderrHit = RATE_LIMIT.exec(stderr);
    if (stderrHit !== null)
        return { kind: "rate-limited", detail: stderrHit[0] };
    let envelope;
    try {
        envelope = JSON.parse(resultJson);
    }
    catch {
        return { kind: "error", detail: `unparseable result envelope (exit ${exitCode})` };
    }
    if (envelope === null || typeof envelope !== "object" || Array.isArray(envelope)) {
        return { kind: "error", detail: `non-object envelope (exit ${exitCode})` };
    }
    // Rate-limit detection is scoped to envelope.result, and only when short:
    // a genuine limit notice IS the whole result and is short; an agent summary
    // that merely quotes the phrase (e.g. a ticket about API/retry code) is long.
    if (typeof envelope.result === "string" && envelope.result.trim().length < 300) {
        const resultHit = RATE_LIMIT.exec(envelope.result);
        if (resultHit !== null)
            return { kind: "rate-limited", detail: resultHit[0] };
    }
    if (exitCode !== 0)
        return { kind: "error", detail: `claude exited ${exitCode}: ${stderr.slice(0, 200)}` };
    return {
        kind: "ok",
        costUsd: typeof envelope.total_cost_usd === "number" ? envelope.total_cost_usd : undefined,
        sessionId: typeof envelope.session_id === "string" ? envelope.session_id : undefined,
        detail: undefined,
    };
}
