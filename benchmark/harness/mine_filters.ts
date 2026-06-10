import ignore from "ignore";

export interface PrFile {
  path: string;
  additions: number;
  deletions: number;
}

export interface SplitResult {
  test: string[];
  src: string[];
}

/** Classify changed files using the repo's gitignore-style test_patterns — the single definition of "test file". */
export function splitFiles(files: readonly PrFile[], testPatterns: readonly string[]): SplitResult {
  const matcher = ignore().add([...testPatterns]);
  const test: string[] = [];
  const src: string[] = [];
  for (const f of files) {
    (matcher.ignores(f.path) ? test : src).push(f.path);
  }
  return { test, src };
}

export const MAX_CHANGED_LINES = 400;
export const MIN_BODY_LENGTH = 200;

export interface EligibilityInput {
  files: readonly PrFile[];
  authorIsBot: boolean;
  bodyLength: number;
  mergedAt: string; // ISO
}

export interface EligibilityConfig {
  test_patterns: readonly string[];
  ticket_after: string; // ISO date
}

export type Eligibility =
  | { ok: true; test_files: string[]; src_files: string[]; changed_lines: number }
  | { ok: false; reason: string };

export function checkEligibility(input: EligibilityInput, cfg: EligibilityConfig): Eligibility {
  if (input.authorIsBot) return { ok: false, reason: "bot-author" };
  if (input.bodyLength < MIN_BODY_LENGTH) return { ok: false, reason: "thin-body" };
  if (Date.parse(input.mergedAt) < Date.parse(cfg.ticket_after)) {
    return { ok: false, reason: "before-ticket-after" };
  }
  const changed = input.files.reduce((n, f) => n + f.additions + f.deletions, 0);
  if (changed >= MAX_CHANGED_LINES) return { ok: false, reason: "too-large" };
  const { test, src } = splitFiles(input.files, cfg.test_patterns);
  if (test.length === 0) return { ok: false, reason: "no-test-changes" };
  if (src.length === 0) return { ok: false, reason: "no-source-changes" };
  return { ok: true, test_files: test, src_files: src, changed_lines: changed };
}
