/**
 * Tests for security_check.ts — ported from test_security_check.py.
 *
 * Each Python `def test_*` becomes a Vitest `it()` block. The CLI-invocation
 * tests shell out to the compiled `security_check.js` via Node, just like
 * the Python tests shell out to `security_check.py` via subprocess.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  validateUrl,
  checkPathContainment,
  sanitizeLabel,
} from "../security_check.js";
import {
  SCRIPTS_DIR,
  makeTmpPath,
  cleanupTmpPath,
} from "./fixtures.js";

const CLI = path.join(SCRIPTS_DIR, "security_check.js");

/** Run the compiled CLI; returns { stdout, stderr, status }. */
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

// ------------------------------------------------------------------
// URL validation tests
// ------------------------------------------------------------------

describe("TestValidateUrl", () => {
  it("valid_http_url", () => {
    expect(validateUrl("http://example.com")).toBe(true);
  });

  it("valid_https_url", () => {
    expect(validateUrl("https://example.com")).toBe(true);
  });

  it("block_file_url", () => {
    expect(validateUrl("file:///etc/passwd")).toBe(false);
  });

  it("block_data_url", () => {
    expect(validateUrl("data:text/html,<h1>hi</h1>")).toBe(false);
  });

  it("block_ftp_url", () => {
    expect(validateUrl("ftp://server/file")).toBe(false);
  });

  it("empty_url_fails", () => {
    expect(validateUrl("")).toBe(false);
  });
});

// ------------------------------------------------------------------
// Path containment tests
// ------------------------------------------------------------------

describe("TestCheckPathContainment", () => {
  let tmpPath: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("sec-check-");
  });

  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("path_inside_wiki_root_passes", () => {
    const wikiRoot = path.join(tmpPath, "wiki-root");
    fs.mkdirSync(wikiRoot);
    const pageDir = path.join(wikiRoot, "wiki");
    fs.mkdirSync(pageDir, { recursive: true });
    const page = path.join(pageDir, "page.md");
    fs.writeFileSync(page, "");
    expect(checkPathContainment(page, wikiRoot)).toBe(true);
  });

  it("path_outside_wiki_root_fails", () => {
    const wikiRoot = path.join(tmpPath, "wiki-root");
    fs.mkdirSync(wikiRoot);
    const evilPath = path.join(wikiRoot, "..", "..", "etc", "passwd");
    expect(checkPathContainment(evilPath, wikiRoot)).toBe(false);
  });

  it("symlink_traversal_fails", () => {
    const wikiRoot = path.join(tmpPath, "wiki-root");
    fs.mkdirSync(wikiRoot);
    const outside = path.join(tmpPath, "outside");
    fs.mkdirSync(outside);
    const secret = path.join(outside, "secret.txt");
    fs.writeFileSync(secret, "secret");

    const link = path.join(wikiRoot, "sneaky_link");
    fs.symlinkSync(secret, link);

    expect(checkPathContainment(link, wikiRoot)).toBe(false);
  });

  it("symlink_cycle_fails_closed", () => {
    const wikiRoot = path.join(tmpPath, "wiki-root");
    fs.mkdirSync(wikiRoot);
    const a = path.join(wikiRoot, "link-a");
    const b = path.join(wikiRoot, "link-b");
    fs.symlinkSync(b, a);
    fs.symlinkSync(a, b);
    expect(checkPathContainment(a, wikiRoot)).toBe(false);
  });
});

// ------------------------------------------------------------------
// Label sanitization tests
// ------------------------------------------------------------------

describe("TestSanitizeLabel", () => {
  it("label_sanitization_strips_control_chars", () => {
    const result = sanitizeLabel("hello\x00\x01world");
    expect(result).not.toContain("\x00");
    expect(result).not.toContain("\x01");
    expect(result).toContain("helloworld");
  });

  it("label_sanitization_caps_length", () => {
    const longLabel = "a".repeat(500);
    const result = sanitizeLabel(longLabel);
    expect(result.length).toBeLessThanOrEqual(256);
  });

  it("label_sanitization_html_escapes", () => {
    const result = sanitizeLabel("<script>alert(1)</script>");
    expect(result).not.toContain("<script>");
    expect(result).toContain("&lt;script&gt;");
  });
});

// ------------------------------------------------------------------
// CLI interface tests
// ------------------------------------------------------------------

describe("TestSecurityCheckCLI", () => {
  let tmpPath: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("sec-cli-");
  });

  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("cli_url_valid", () => {
    const result = runCli(["--url", "https://example.com"]);
    expect(result.status).toBe(0);
  });

  it("cli_url_invalid", () => {
    const result = runCli(["--url", "file:///etc/passwd"]);
    expect(result.status).toBe(1);
    const body = JSON.parse(result.stdout);
    expect(body).toHaveProperty("error");
  });

  it("cli_path_containment", () => {
    const wikiRoot = path.join(tmpPath, "wiki-root");
    fs.mkdirSync(wikiRoot);
    const page = path.join(wikiRoot, "page.md");
    fs.writeFileSync(page, "");
    const result = runCli(["--path", page, "--wiki-root", wikiRoot]);
    expect(result.status).toBe(0);
  });

  it("cli_label", () => {
    const result = runCli(["--label", "<b>bold</b>"]);
    expect(result.status).toBe(0);
    const body = JSON.parse(result.stdout);
    expect(body.sanitized).toContain("&lt;b&gt;");
  });
});
