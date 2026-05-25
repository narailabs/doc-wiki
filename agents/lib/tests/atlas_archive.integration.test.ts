/**
 * End-to-end integration test for atlas_archive.ts.
 *
 * Exercises the full sweep → unarchive cycle through real CLI invocations
 * (node atlas_archive.js ...) to catch wiring bugs in the CLI layer.
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as yaml from "js-yaml";

const AGENTS_LIB = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const CLI = path.join(AGENTS_LIB, "atlas_archive.js");

function runCli(
  args: readonly string[],
): { stdout: string; stderr: string; status: number } {
  try {
    const stdout = execFileSync("node", [CLI, ...args], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { stdout, stderr: "", status: 0 };
  } catch (e) {
    const err = e as NodeJS.ErrnoException & {
      status?: number;
      stdout?: Buffer | string;
      stderr?: Buffer | string;
    };
    return {
      stdout: typeof err.stdout === "string" ? err.stdout : (err.stdout?.toString("utf-8") ?? ""),
      stderr: typeof err.stderr === "string" ? err.stderr : (err.stderr?.toString("utf-8") ?? ""),
      status: err.status ?? 1,
    };
  }
}

/** Write a wiki page with YAML frontmatter + body. */
function writePage(
  wikiRoot: string,
  relPath: string,
  fm: Record<string, unknown>,
  body = "page body\n",
): void {
  const abs = path.join(wikiRoot, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `---\n${yaml.dump(fm)}---\n${body}`, "utf-8");
}

describe("atlas_archive CLI — end-to-end sweep + unarchive cycle", () => {
  it("sweep archives orphan page, rewrites inbound links; unarchive reverses both; journal records both ops", async () => {
    const wikiRoot = fs.mkdtempSync(
      path.join(require("node:os").tmpdir(), "atlas-archive-int-"),
    );
    // repoRoot is a sibling dir with no src/billing/ — so billing page is orphaned
    const repoRoot = fs.mkdtempSync(
      path.join(require("node:os").tmpdir(), "atlas-archive-repo-"),
    );

    try {
      // ── Build fixture ──────────────────────────────────────────────────────

      // Orphan atlas page: sources point to src/billing/ which doesn't exist in repoRoot
      writePage(
        wikiRoot,
        "wiki/billing/architecture.md",
        {
          atlas_facet: "architecture",
          sources: ["src/billing/"],
          title: "Billing Architecture",
        },
        "Billing service architecture overview.\n",
      );

      // Live atlas page with an inbound link to billing/architecture.md
      writePage(
        wikiRoot,
        "wiki/auth/jwt.md",
        {
          atlas_facet: "architecture",
          sources: ["src/auth/"],
          title: "JWT Auth",
        },
        "Auth page.\n\nSee also [Billing flow](../billing/architecture.md) for context.\n",
      );

      // src/auth/ exists in repoRoot so jwt.md is not orphaned
      fs.mkdirSync(path.join(repoRoot, "src/auth"), { recursive: true });

      // wiki.config.yaml — sweep reads flags only, but the file must be present
      // for any config-driven path; include archive settings for completeness.
      fs.writeFileSync(
        path.join(wikiRoot, "wiki.config.yaml"),
        yaml.dump({
          ecosystem: {
            archive: {
              enabled: true,
              partial_threshold: 1.0,
              inbound_links: "rewrite",
            },
          },
        }),
        "utf-8",
      );

      // Empty events.jsonl
      fs.writeFileSync(path.join(wikiRoot, "events.jsonl"), "", "utf-8");

      // ── Step 1: sweep ──────────────────────────────────────────────────────

      const sweepResult = runCli([
        "sweep",
        "--wiki-root", wikiRoot,
        "--repo-root", repoRoot,
        "--autonomy", "autonomous",
        "--run-id", "test-run",
      ]);
      expect(sweepResult.status, `sweep stderr: ${sweepResult.stderr}`).toBe(0);

      // billing/architecture.md must have moved to _archive
      expect(
        fs.existsSync(path.join(wikiRoot, "wiki/_archive/billing/architecture.md")),
      ).toBe(true);
      expect(
        fs.existsSync(path.join(wikiRoot, "wiki/billing/architecture.md")),
      ).toBe(false);

      // jwt.md inbound link should be rewritten with (archived) label
      const jwt1 = fs.readFileSync(path.join(wikiRoot, "wiki/auth/jwt.md"), "utf-8");
      expect(jwt1).toContain("(archived)");
      expect(jwt1).toContain("_archive/billing/architecture.md");

      // ── Step 2: unarchive ─────────────────────────────────────────────────

      const unarchiveResult = runCli([
        "unarchive",
        "--wiki-root", wikiRoot,
        "--page-or-slug", "architecture",
      ]);
      expect(
        unarchiveResult.status,
        `unarchive stderr: ${unarchiveResult.stderr}`,
      ).toBe(0);

      // billing/architecture.md must be back in its original location
      expect(
        fs.existsSync(path.join(wikiRoot, "wiki/billing/architecture.md")),
      ).toBe(true);
      expect(
        fs.existsSync(path.join(wikiRoot, "wiki/_archive/billing/architecture.md")),
      ).toBe(false);

      // jwt.md inbound link should be reverted — no (archived), original path
      const jwt2 = fs.readFileSync(path.join(wikiRoot, "wiki/auth/jwt.md"), "utf-8");
      expect(jwt2).not.toContain("(archived)");
      expect(jwt2).toContain("../billing/architecture.md");

      // ── Step 3: journal has both events ───────────────────────────────────

      const journalPath = path.join(wikiRoot, "_archive_history.jsonl");
      expect(fs.existsSync(journalPath)).toBe(true);
      const lines = fs
        .readFileSync(journalPath, "utf-8")
        .split("\n")
        .filter(Boolean);
      expect(lines).toHaveLength(2);
      expect(JSON.parse(lines[0]!).op).toBe("archive");
      expect(JSON.parse(lines[1]!).op).toBe("unarchive");
    } finally {
      fs.rmSync(wikiRoot, { recursive: true, force: true });
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
