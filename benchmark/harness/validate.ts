#!/usr/bin/env -S npx tsx
// doc-wiki benchmark pre-flight validator.
//
// For each (repo, issue) in repos.yaml:
//   - confirm the fix_commit SHA exists in the upstream repo (gh api commits/<sha>)
//   - confirm the test_path exists in the tree at fix_commit
//   - flag any placeholder SHAs (40 zeros) so they don't accidentally run
//
// Does NOT clone or install anything; uses `gh api` only. Cheap to run.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { load as yamlLoad } from "js-yaml";

interface RepoConfig {
  id: string;
  url: string;
  issues: IssueConfig[];
}

interface IssueConfig {
  id: string;
  fix_commit: string;
  test_path: string;
}

interface Manifest {
  repos: RepoConfig[];
}

interface ValidationRow {
  repo: string;
  issue: string;
  status: "pass" | "warn" | "fail";
  reason: string;
}

const HERE = dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = resolve(HERE, "..", "repos.yaml");
const PLACEHOLDER = "0".repeat(40);

function loadManifest(): Manifest {
  return yamlLoad(readFileSync(MANIFEST_PATH, "utf-8")) as Manifest;
}

function repoSlug(url: string): string {
  // "https://github.com/django/django" -> "django/django"
  return url.replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, "");
}

function commitExists(slug: string, sha: string): boolean {
  const cp = spawnSync("gh", ["api", `repos/${slug}/commits/${sha}`, "--silent"], {
    encoding: "utf-8",
  });
  return cp.status === 0;
}

function pathExistsAt(slug: string, sha: string, path: string): boolean {
  // Strip pytest-style "::TestClass::test_name" suffix to get the bare file path.
  const filePath = path.split("::")[0];
  if (!filePath) return false;
  const cp = spawnSync(
    "gh",
    ["api", `repos/${slug}/contents/${filePath}?ref=${sha}`, "--silent"],
    { encoding: "utf-8" },
  );
  return cp.status === 0;
}

function validate(repo: RepoConfig, issue: IssueConfig): ValidationRow {
  const slug = repoSlug(repo.url);
  const out: ValidationRow = { repo: repo.id, issue: issue.id, status: "pass", reason: "ok" };

  if (issue.fix_commit === PLACEHOLDER || issue.fix_commit.length !== 40) {
    out.status = "warn";
    out.reason = "placeholder fix_commit — curate before running";
    return out;
  }

  if (!commitExists(slug, issue.fix_commit)) {
    out.status = "fail";
    out.reason = `fix_commit ${issue.fix_commit.slice(0, 10)} not found in ${slug}`;
    return out;
  }

  if (!pathExistsAt(slug, issue.fix_commit, issue.test_path)) {
    out.status = "fail";
    out.reason = `test_path ${issue.test_path} missing at fix_commit`;
    return out;
  }

  return out;
}

function emit(rows: ValidationRow[]): void {
  const widthRepo = Math.max(4, ...rows.map((r) => r.repo.length));
  const widthIssue = Math.max(5, ...rows.map((r) => r.issue.length));
  const symbol: Record<ValidationRow["status"], string> = {
    pass: "✓",
    warn: "!",
    fail: "✗",
  };
  console.log("");
  console.log(
    `${"repo".padEnd(widthRepo)}  ${"issue".padEnd(widthIssue)}  status  reason`,
  );
  console.log(
    "-".repeat(widthRepo + widthIssue + 30),
  );
  for (const r of rows) {
    console.log(
      `${r.repo.padEnd(widthRepo)}  ${r.issue.padEnd(widthIssue)}  ${symbol[r.status]} ${r.status.padEnd(4)}  ${r.reason}`,
    );
  }
  const passes = rows.filter((r) => r.status === "pass").length;
  const warns = rows.filter((r) => r.status === "warn").length;
  const fails = rows.filter((r) => r.status === "fail").length;
  console.log("");
  console.log(`${passes} pass, ${warns} warn, ${fails} fail (${rows.length} total)`);
}

function main(): void {
  const manifest = loadManifest();
  const rows: ValidationRow[] = [];
  for (const repo of manifest.repos) {
    for (const issue of repo.issues) {
      rows.push(validate(repo, issue));
    }
  }
  emit(rows);
  const hasFailures = rows.some((r) => r.status === "fail");
  process.exit(hasFailures ? 1 : 0);
}

main();
