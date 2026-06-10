import type { SessionResult, TicketRecord } from "./types.js";

/** The exact, fixed prompt both arms receive. The wiki is never mentioned — the wiki arm must discover it via CLAUDE.md like a real agent. */
export function buildPrompt(t: TicketRecord): string {
  return `${t.title}\n\n${t.body_sanitized}\n\nInvestigate and fix this issue in this repository. Run the relevant tests to check your fix.`;
}

// Matches both straight apostrophe (U+0027) and right single quotation mark (U+2019)
const RATE_LIMIT = /You['’]ve hit your .{0,40}limit[^\n"]*/i;

/**
 * Classify a finished session from its JSON envelope + exit code + stderr.
 * Rate-limit detection is best-effort: anything unrecognized is "error"
 * (re-queued on resume), so a changed message can never corrupt results.
 */
export function classifySession(resultJson: string, exitCode: number, stderr: string): SessionResult {
  const limitHit = RATE_LIMIT.exec(resultJson) ?? RATE_LIMIT.exec(stderr);
  if (limitHit !== null) return { kind: "rate-limited", detail: limitHit[0] };

  let envelope: { result?: unknown; total_cost_usd?: unknown; session_id?: unknown };
  try {
    envelope = JSON.parse(resultJson) as typeof envelope;
  } catch {
    return { kind: "error", detail: `unparseable result envelope (exit ${exitCode})` };
  }
  if (exitCode !== 0) return { kind: "error", detail: `claude exited ${exitCode}: ${stderr.slice(0, 200)}` };
  return {
    kind: "ok",
    costUsd: typeof envelope.total_cost_usd === "number" ? envelope.total_cost_usd : undefined,
    sessionId: typeof envelope.session_id === "string" ? envelope.session_id : undefined,
    detail: undefined,
  };
}
