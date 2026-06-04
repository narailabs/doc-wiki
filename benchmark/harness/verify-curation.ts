#!/usr/bin/env -S npx tsx
// Spot-check repos.yaml: for each (issue_id, fix_commit, pr_url) tuple,
// confirm the named fix commit actually fixes the named issue.
//
// Three checks, in order:
//   1. The commit message references the issue_id
//   2. The PR body references the issue_id ("Closes #N", "Fixes #N", inline "#N")
//   3. The PR has the issue in its closingIssuesReferences (GitHub-side link)
//
// PASS if any check passes. FLAG otherwise — the entry may be wrong (we already
// found django/36966 was for a different ticket). Output is a markdown report.

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { load as yamlLoad } from "js-yaml";

interface IssueEntry {
  id: string;
  fix_commit: string;
  pr_url?: string;
  issue_url?: string;
  title?: string;
}

interface RepoEntry {
  id: string;
  url: string;
  issues: IssueEntry[];
}

interface Manifest {
  repos: RepoEntry[];
}

interface VerificationRow {
  repo: string;
  issue_id: string;
  sha_short: string;
  status: "pass" | "flag" | "fail";
  evidence: string;
}

const HERE = dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = resolve(HERE, "..", "repos.yaml");
const REPORT_PATH = resolve(HERE, "..", "results", "curation-report.md");

function loadManifest(): Manifest {
  return yamlLoad(readFileSync(MANIFEST_PATH, "utf-8")) as Manifest;
}

function repoSlug(url: string): string {
  return url.replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, "");
}

function ghJson(path: string): unknown {
  const cp = spawnSync("gh", ["api", path], { encoding: "utf-8" });
  if (cp.status !== 0) return null;
  try {
    return JSON.parse(cp.stdout);
  } catch {
    return null;
  }
}

function referencesIssue(text: string, issueId: string): boolean {
  if (!text) return false;
  const t = text.toLowerCase();
  const id = issueId.toLowerCase();
  // Match: #N, fixed #N, fixes #N, closes #N, ticket-N, /ticket/N
  const patterns = [
    new RegExp(`#${id}\\b`),
    new RegExp(`fixed[^\\d]+${id}\\b`),
    new RegExp(`fixes[^\\d]+${id}\\b`),
    new RegExp(`closes[^\\d]+${id}\\b`),
    new RegExp(`ticket[/-]${id}\\b`),
  ];
  return patterns.some((p) => p.test(t));
}

function verify(repo: RepoEntry, issue: IssueEntry): VerificationRow {
  const slug = repoSlug(repo.url);
  const shaShort = issue.fix_commit.slice(0, 10);
  const out: VerificationRow = {
    repo: repo.id,
    issue_id: issue.id,
    sha_short: shaShort,
    status: "flag",
    evidence: "no reference found",
  };

  // 1. Commit message check
  const commit = ghJson(`repos/${slug}/commits/${issue.fix_commit}`) as {
    commit?: { message?: string };
  } | null;
  if (!commit) {
    out.status = "fail";
    out.evidence = `commit ${shaShort} does not exist in ${slug}`;
    return out;
  }
  const commitMsg = commit.commit?.message ?? "";
  if (referencesIssue(commitMsg, issue.id)) {
    out.status = "pass";
    out.evidence = `commit msg references #${issue.id}`;
    return out;
  }

  // 2. PR body / title check (if pr_url is present)
  if (issue.pr_url) {
    const m = issue.pr_url.match(/\/pull\/(\d+)$/);
    if (m) {
      const prNum = m[1];
      const pr = ghJson(`repos/${slug}/pulls/${prNum}`) as {
        title?: string;
        body?: string;
      } | null;
      if (pr) {
        const haystack = `${pr.title ?? ""}\n${pr.body ?? ""}`;
        if (referencesIssue(haystack, issue.id)) {
          out.status = "pass";
          out.evidence = `PR #${prNum} title/body references #${issue.id}`;
          return out;
        }
        // 3. closingIssuesReferences via GraphQL
        const graphqlQuery = `{
          repository(owner: "${slug.split("/")[0]}", name: "${slug.split("/")[1]}") {
            pullRequest(number: ${prNum}) {
              closingIssuesReferences(first: 10) {
                nodes { number }
              }
            }
          }
        }`;
        const cp = spawnSync("gh", ["api", "graphql", "-f", `query=${graphqlQuery}`], {
          encoding: "utf-8",
        });
        if (cp.status === 0) {
          try {
            const data = JSON.parse(cp.stdout) as {
              data?: {
                repository?: {
                  pullRequest?: {
                    closingIssuesReferences?: { nodes?: { number: number }[] };
                  };
                };
              };
            };
            const linked =
              data.data?.repository?.pullRequest?.closingIssuesReferences?.nodes ?? [];
            if (linked.some((n) => String(n.number) === issue.id)) {
              out.status = "pass";
              out.evidence = `PR #${prNum} closingIssuesReferences includes #${issue.id}`;
              return out;
            }
          } catch {
            /* swallow */
          }
        }
        out.evidence = `commit + PR #${prNum} neither references #${issue.id}`;
        return out;
      }
    }
  }

  out.evidence = `commit msg does not reference #${issue.id}; no PR data available`;
  return out;
}

function fmtTable(rows: VerificationRow[]): string {
  const symbol: Record<VerificationRow["status"], string> = {
    pass: "✓",
    flag: "⚠",
    fail: "✗",
  };
  const lines: string[] = [];
  lines.push("# Curation verification report");
  lines.push("");
  lines.push(`_Generated: ${new Date().toISOString()}. ${rows.length} entries checked._`);
  lines.push("");
  const passes = rows.filter((r) => r.status === "pass").length;
  const flags = rows.filter((r) => r.status === "flag").length;
  const fails = rows.filter((r) => r.status === "fail").length;
  lines.push(`**${passes} pass · ${flags} flag · ${fails} fail**`);
  lines.push("");
  lines.push("| Status | Repo | Issue | SHA | Evidence |");
  lines.push("|---|---|---|---|---|");
  for (const r of rows) {
    lines.push(
      `| ${symbol[r.status]} ${r.status} | ${r.repo} | ${r.issue_id} | \`${r.sha_short}\` | ${r.evidence} |`,
    );
  }
  lines.push("");
  if (flags + fails > 0) {
    lines.push("## Next steps");
    lines.push("");
    lines.push(
      "For each flagged entry, run `git log --all --grep='<issue_id>' --format='%H %s'` against the repo to find the real fix commit and update `repos.yaml`.",
    );
  }
  return lines.join("\n");
}

function main(): void {
  const manifest = loadManifest();
  const rows: VerificationRow[] = [];
  let i = 0;
  let total = 0;
  for (const r of manifest.repos) total += r.issues.length;
  for (const repo of manifest.repos) {
    for (const issue of repo.issues) {
      i++;
      process.stdout.write(`[${i}/${total}] ${repo.id}/${issue.id}... `);
      const row = verify(repo, issue);
      process.stdout.write(`${row.status}\n`);
      rows.push(row);
    }
  }
  const report = fmtTable(rows);
  writeFileSync(REPORT_PATH, report);
  console.log("");
  console.log(`wrote ${REPORT_PATH}`);
  const flags = rows.filter((r) => r.status === "flag" || r.status === "fail").length;
  if (flags > 0) {
    console.log(`\n${flags} entries need attention:`);
    for (const r of rows.filter((s) => s.status !== "pass")) {
      console.log(`  ${r.repo}/${r.issue_id} (${r.sha_short}): ${r.evidence}`);
    }
    process.exit(1);
  }
}

main();
