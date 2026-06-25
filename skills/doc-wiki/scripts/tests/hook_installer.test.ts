/**
 * Tests for hook_installer.ts — the multi-platform PreToolUse installer.
 *
 * Every installer must be idempotent (second run returns
 * `{installed: false}`), preserve unrelated user keys byte-for-byte, and
 * wire `security_check.js` into the right hook slot per platform.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  installClaudeCodeHooks,
  installCodexHooks,
  installCursorHooks,
  installAiderHooks,
} from "../hook_installer.js";
import { makeTmpPath, cleanupTmpPath } from "./fixtures.js";

// ── Claude Code ────────────────────────────────────────────────────────

describe("installClaudeCodeHooks", () => {
  let tmpPath: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("hook-installer-cc-");
  });

  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("creates .claude/settings.json on first run", () => {
    const result = installClaudeCodeHooks(tmpPath);
    expect(result.installed).toBe(true);
    expect(fs.existsSync(result.settingsPath)).toBe(true);
    expect(result.settingsPath).toBe(
      path.join(tmpPath, ".claude", "settings.json"),
    );
  });

  it("wires the three expected matchers with security_check.js commands", () => {
    const { settingsPath } = installClaudeCodeHooks(tmpPath);
    const parsed = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    const entries: Array<{
      matcher: string;
      hooks: Array<{ type: string; command: string }>;
    }> = parsed.hooks.PreToolUse;
    const matchers = entries.map((e) => e.matcher);
    expect(matchers).toContain("WebFetch");
    expect(matchers).toContain("WebSearch");
    expect(matchers).toContain("Write|Edit|MultiEdit");
    for (const e of entries) {
      expect(e.hooks[0]?.type).toBe("command");
      expect(e.hooks[0]?.command).toContain("security_check.js");
      expect(e.hooks[0]?.command).toContain(tmpPath);
    }
  });

  it("is idempotent — second run returns {installed: false}", () => {
    const first = installClaudeCodeHooks(tmpPath);
    expect(first.installed).toBe(true);
    const before = fs.readFileSync(first.settingsPath, "utf-8");

    const second = installClaudeCodeHooks(tmpPath);
    expect(second.installed).toBe(false);

    const after = fs.readFileSync(first.settingsPath, "utf-8");
    expect(after).toBe(before);
  });

  it("preserves unrelated top-level user keys", () => {
    const settingsPath = path.join(tmpPath, ".claude", "settings.json");
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(
      settingsPath,
      JSON.stringify(
        {
          permissions: { allow: ["Bash(ls)"] },
          model: "opus",
        },
        null,
        2,
      ) + "\n",
    );

    const result = installClaudeCodeHooks(tmpPath);
    expect(result.installed).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    expect(parsed.permissions.allow).toEqual(["Bash(ls)"]);
    expect(parsed.model).toBe("opus");
    expect(Array.isArray(parsed.hooks.PreToolUse)).toBe(true);
  });

  it("preserves existing user PreToolUse entries", () => {
    const settingsPath = path.join(tmpPath, ".claude", "settings.json");
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    const userEntry = {
      matcher: "Bash",
      hooks: [{ type: "command", command: "echo user" }],
    };
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({ hooks: { PreToolUse: [userEntry] } }, null, 2) + "\n",
    );

    installClaudeCodeHooks(tmpPath);
    const parsed = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    const entries: Array<{ matcher: string }> = parsed.hooks.PreToolUse;
    expect(entries.some((e) => e.matcher === "Bash")).toBe(true);
    expect(entries.some((e) => e.matcher === "WebFetch")).toBe(true);
  });

  it("does not duplicate our entries when user has one of ours already", () => {
    installClaudeCodeHooks(tmpPath);
    const settingsPath = path.join(tmpPath, ".claude", "settings.json");
    const parsed1 = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    const count1 = parsed1.hooks.PreToolUse.length;

    installClaudeCodeHooks(tmpPath);
    const parsed2 = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    expect(parsed2.hooks.PreToolUse.length).toBe(count1);
  });
});

// ── Codex ──────────────────────────────────────────────────────────────

describe("installCodexHooks", () => {
  let tmpPath: string;
  beforeEach(() => {
    tmpPath = makeTmpPath("hook-installer-codex-");
  });
  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("creates .codex/hooks.json on first run", () => {
    const result = installCodexHooks(tmpPath);
    expect(result.installed).toBe(true);
    expect(result.settingsPath).toBe(
      path.join(tmpPath, ".codex", "hooks.json"),
    );
    const parsed = JSON.parse(fs.readFileSync(result.settingsPath, "utf-8"));
    expect(Array.isArray(parsed.preToolUse)).toBe(true);
    const matchers = parsed.preToolUse.map(
      (e: { matcher: string }) => e.matcher,
    );
    expect(matchers).toContain("WebFetch");
    expect(matchers).toContain("WebSearch");
    expect(matchers).toContain("Write|Edit|MultiEdit");
  });

  it("is idempotent — second run returns {installed: false}", () => {
    const first = installCodexHooks(tmpPath);
    expect(first.installed).toBe(true);
    const second = installCodexHooks(tmpPath);
    expect(second.installed).toBe(false);
  });

  it("preserves unrelated user keys", () => {
    const settingsPath = path.join(tmpPath, ".codex", "hooks.json");
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({ custom: { flag: true }, unrelated: [1, 2] }, null, 2) +
        "\n",
    );
    installCodexHooks(tmpPath);
    const parsed = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    expect(parsed.custom).toEqual({ flag: true });
    expect(parsed.unrelated).toEqual([1, 2]);
    expect(Array.isArray(parsed.preToolUse)).toBe(true);
  });
});

// ── Cursor ─────────────────────────────────────────────────────────────

describe("installCursorHooks", () => {
  let tmpPath: string;
  beforeEach(() => {
    tmpPath = makeTmpPath("hook-installer-cursor-");
  });
  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("creates .cursor/hooks.json on first run", () => {
    const result = installCursorHooks(tmpPath);
    expect(result.installed).toBe(true);
    expect(result.settingsPath).toBe(
      path.join(tmpPath, ".cursor", "hooks.json"),
    );
    const parsed = JSON.parse(fs.readFileSync(result.settingsPath, "utf-8"));
    expect(Array.isArray(parsed.preToolUse)).toBe(true);
  });

  it("is idempotent — second run returns {installed: false}", () => {
    const first = installCursorHooks(tmpPath);
    expect(first.installed).toBe(true);
    const second = installCursorHooks(tmpPath);
    expect(second.installed).toBe(false);
  });

  it("preserves unrelated user keys", () => {
    const settingsPath = path.join(tmpPath, ".cursor", "hooks.json");
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({ editor: { theme: "dark" } }, null, 2) + "\n",
    );
    installCursorHooks(tmpPath);
    const parsed = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    expect(parsed.editor).toEqual({ theme: "dark" });
    expect(Array.isArray(parsed.preToolUse)).toBe(true);
  });
});

// ── Aider ──────────────────────────────────────────────────────────────

describe("installAiderHooks", () => {
  let tmpPath: string;
  beforeEach(() => {
    tmpPath = makeTmpPath("hook-installer-aider-");
  });
  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("creates .aider/hooks on first run", () => {
    const result = installAiderHooks(tmpPath);
    expect(result.installed).toBe(true);
    expect(result.settingsPath).toBe(path.join(tmpPath, ".aider", "hooks"));
    const body = fs.readFileSync(result.settingsPath, "utf-8");
    expect(body).toContain("wiki-pre-tool-use");
    expect(body).toContain("security_check.js");
    expect(body).toContain("WebFetch");
    expect(body).toContain("WebSearch");
  });

  it("is idempotent — second run returns {installed: false}", () => {
    const first = installAiderHooks(tmpPath);
    expect(first.installed).toBe(true);
    const before = fs.readFileSync(first.settingsPath, "utf-8");

    const second = installAiderHooks(tmpPath);
    expect(second.installed).toBe(false);
    const after = fs.readFileSync(first.settingsPath, "utf-8");
    expect(after).toBe(before);
  });

  it("preserves user content outside the managed block", () => {
    const settingsPath = path.join(tmpPath, ".aider", "hooks");
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(
      settingsPath,
      "# user prologue\nalias foo=bar\n# user epilogue\n",
    );
    installAiderHooks(tmpPath);
    const body = fs.readFileSync(settingsPath, "utf-8");
    expect(body).toContain("user prologue");
    expect(body).toContain("alias foo=bar");
    expect(body).toContain("wiki-pre-tool-use");
  });

  it("replaces the managed block in place on re-install without growing", () => {
    installAiderHooks(tmpPath);
    const settingsPath = path.join(tmpPath, ".aider", "hooks");

    // Simulate a change (e.g. moved wiki root) — overwrite the managed
    // block body with a stale command, then re-install and confirm the
    // file contains exactly one managed block.
    let body = fs.readFileSync(settingsPath, "utf-8");
    body = body.replace("security_check.js", "STALE_CHECK");
    fs.writeFileSync(settingsPath, body);

    installAiderHooks(tmpPath);
    const updated = fs.readFileSync(settingsPath, "utf-8");
    const startMatches = updated.match(/wiki-pre-tool-use \(managed\) >>>/g);
    const endMatches = updated.match(/wiki-pre-tool-use \(managed\) <<</g);
    expect(startMatches?.length).toBe(1);
    expect(endMatches?.length).toBe(1);
    expect(updated).toContain("security_check.js");
    expect(updated).not.toContain("STALE_CHECK");
  });
});
