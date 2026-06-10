import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseFlags } from "../../skills/doc-wiki/scripts/_cli_args.js";
import type { Runner } from "./exec.js";
import { realRunner } from "./exec.js";
import { checkEligibility } from "./mine_filters.js";
import { loadRepoConfig } from "./repo_config.js";
import { sanitizeIssueBody } from "./sanitize.js";
import type { RepoConfig, TicketRecord, TicketsFile } from "./types.js";

interface MineOpts {
  target: number;
  limit: number;
  runner: Runner;
}

async function ghJson<T>(runner: Runner, args: string[]): Promise<T | undefined> {
  const r = await runner("gh", args);
  if (r.code !== 0) {
    process.stderr.write(`gh ${args.join(" ")} failed: ${r.stderr}\n`);
    return undefined;
  }
  try {
    return JSON.parse(r.stdout) as T;
  } catch {
    process.stderr.write(`gh ${args.join(" ")} returned non-JSON\n`);
    return undefined;
  }
}

interface PrListEntry { number: number; url: string; mergedAt: string }
interface PrView {
  number: number; url: string; title: string;
  files: Array<{ path: string; additions: number; deletions: number }>;
  closingIssuesReferences: Array<{ number: number }>;
  mergeCommit: { oid: string } | null;
  mergedAt: string;
  author?: { login?: string; is_bot?: boolean };
}
interface IssueView { number: number; html_url: string; title: string; body: string | null; pull_request?: unknown }
interface CommitView { sha: string; parents: Array<{ sha: string }> }

export async function mineGithub(cfg: RepoConfig, opts: MineOpts): Promise<TicketsFile> {
  const tickets: TicketRecord[] = [];
  const seenIssues = new Set<number>();

  const prs = await ghJson<PrListEntry[]>(opts.runner, [
    "pr", "list", "--repo", cfg.github, "--state", "merged",
    "--search", `merged:>=${cfg.ticket_after}`,
    "--limit", String(opts.limit), "--json", "number,url,mergedAt",
  ]);
  if (prs === undefined) throw new Error("gh pr list failed");

  for (const entry of prs) {
    if (tickets.length >= opts.target) break;

    const pr = await ghJson<PrView>(opts.runner, [
      "pr", "view", String(entry.number), "--repo", cfg.github,
      "--json", "number,url,title,files,closingIssuesReferences,mergeCommit,mergedAt,author",
    ]);
    if (pr === undefined || pr.mergeCommit === null) continue;
    const issueRef = pr.closingIssuesReferences[0];
    if (issueRef === undefined) { note(pr.number, "no-linked-issue"); continue; }
    if (seenIssues.has(issueRef.number)) { note(pr.number, "duplicate-issue"); continue; }

    const issue = await ghJson<IssueView>(opts.runner, ["api", `repos/${cfg.github}/issues/${issueRef.number}`]);
    if (issue === undefined || issue.pull_request !== undefined) { note(pr.number, "ref-not-an-issue"); continue; }
    const body = issue.body ?? "";

    // Spec criterion #5 (base_commit newer than wiki_commit) is intentionally enforced later
    // (build-wiki ancestor guard + calibration), since wiki_commit is derived FROM the oldest mined base_commit.
    const verdict = checkEligibility(
      { files: pr.files, authorIsBot: pr.author?.is_bot === true, bodyLength: body.length, mergedAt: pr.mergedAt },
      cfg,
    );
    if (!verdict.ok) { note(pr.number, verdict.reason); continue; }

    const commit = await ghJson<CommitView>(opts.runner, ["api", `repos/${cfg.github}/commits/${pr.mergeCommit.oid}`]);
    const parent = commit?.parents[0];
    if (commit === undefined || parent === undefined) { note(pr.number, "no-parent-commit"); continue; }
    if (commit.parents.length > 1) {
      process.stderr.write(`PR #${pr.number}: multi-parent merge (kept; calibration will validate base_commit)\n`);
    }

    const sanitized = sanitizeIssueBody(body, issue.number);
    seenIssues.add(issue.number);
    tickets.push({
      issue: issue.number,
      issue_url: issue.html_url,
      title: issue.title,
      body,
      body_sanitized: sanitized.text,
      fix_pr: pr.number,
      fix_pr_url: pr.url,
      base_commit: parent.sha,
      fix_commit: pr.mergeCommit.oid,
      test_files: verdict.test_files,
      src_files: verdict.src_files,
      run_files: verdict.run_files,
      changed_lines: verdict.changed_lines,
      merge_parents: commit.parents.length,
      merged_at: pr.mergedAt,
    });
    if (sanitized.redactions.length > 0) {
      process.stderr.write(`issue #${issue.number}: redacted ${sanitized.redactions.join(", ")}\n`);
    }
  }
  return { schema_version: 1, repo: cfg.id, mined_at: new Date().toISOString(), tickets };
}

function note(pr: number, reason: string): void {
  process.stderr.write(`PR #${pr}: skipped (${reason})\n`);
}

export async function main(argv: readonly string[]): Promise<number> {
  const { help, values } = parseFlags(argv, {
    "--repo": "repo", "--target": "target", "--limit": "limit", "--out-dir": "outDir",
  });
  if (help || values.repo === undefined) {
    process.stderr.write("usage: benchmark mine --repo <id> [--target 30] [--limit 200] [--out-dir benchmark/tickets]\n");
    return help ? 0 : 2;
  }
  const cfg = loadRepoConfig(join("benchmark", "repos", `${String(values.repo)}.yaml`));
  if (cfg.ticket_source !== "github") {
    process.stderr.write(`ticket_source "${cfg.ticket_source}" not implemented yet (github only)\n`);
    return 2;
  }
  const target = values.target === undefined ? 30 : Number(values.target);
  if (!Number.isInteger(target) || target <= 0) {
    process.stderr.write(`--target must be a positive integer, got "${String(values.target)}"\n`);
    return 2;
  }
  const limit = values.limit === undefined ? 200 : Number(values.limit);
  if (!Number.isInteger(limit) || limit <= 0) {
    process.stderr.write(`--limit must be a positive integer, got "${String(values.limit)}"\n`);
    return 2;
  }
  const out = await mineGithub(cfg, { target, limit, runner: realRunner });
  const outPath = join(String(values.outDir ?? "benchmark/tickets"), `${cfg.id}.json`);
  writeFileSync(outPath, `${JSON.stringify(out, null, 2)}\n`);
  process.stderr.write(`${out.tickets.length} eligible tickets -> ${outPath}\n`);
  return 0;
}
