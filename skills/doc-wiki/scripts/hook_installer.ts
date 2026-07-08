#!/usr/bin/env node
/**
 * PreToolUse hook installer — multi-platform.
 *
 * Writes or merges hook configuration files for supported AI coding
 * platforms so that `security_check.ts` runs before potentially risky
 * tool invocations (WebFetch, WebSearch, file writes targeting `wiki/`
 * or `raw/`). Every installer is idempotent: it reads any existing
 * file, deep-merges with strict priority to pre-existing user keys, and
 * only writes when the merged shape differs from what's already on disk.
 *
 * Currently supported:
 *   - Claude Code — `.claude/settings.json` `hooks.PreToolUse` array
 *   - Codex       — `.codex/hooks.json` `preToolUse` array
 *   - Cursor      — `.cursor/hooks.json` `preToolUse` array
 *   - Aider       — `.aider/hooks` shell file with a pre-tool-use block
 *
 * Each installer returns `{ installed, settingsPath }`:
 *   - `installed: true`  — the file was created or modified
 *   - `installed: false` — no changes needed (second run on same wiki)
 */
import * as fs from "node:fs";
import * as path from "node:path";

export interface InstallResult {
  installed: boolean;
  settingsPath: string;
}

// ── Security check script path ─────────────────────────────────────────

/**
 * Absolute path to the compiled `security_check.js` that lives next to
 * this module. Hook entries invoke it via `node <path>` so the hook
 * fires regardless of the consumer's CWD.
 */
function securityCheckPath(): string {
  // At runtime this module is `.../scripts/hook_installer.js`; resolve
  // the sibling `security_check.js`.
  const here = path.dirname(new URL(import.meta.url).pathname);
  return path.join(here, "security_check.js");
}


function escapeShellArg(arg: string): string {
  // Wrap string in single quotes and escape any internal single quotes.
  // E.g., foo'bar -> 'foo'\''bar'
  return "'" + arg.replace(/'/g, "'\\''") + "'";
}

// ── Deep merge helper ──────────────────────────────────────────────────

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

/**
 * Deep-merge `incoming` into `base`, preferring existing user keys.
 * For plain objects, missing keys are added and existing keys are left
 * untouched. For arrays, incoming entries are appended only when no
 * existing entry has the same `matcher` (or deep-equal shape, for arrays
 * without a `matcher` field). Primitives in `base` are always preserved.
 *
 * This preserves unrelated user settings byte-for-byte and guarantees
 * that running the installer twice is a no-op.
 */
function deepMergePreferExisting(base: Json, incoming: Json): Json {
  if (
    base !== null &&
    incoming !== null &&
    typeof base === "object" &&
    typeof incoming === "object" &&
    !Array.isArray(base) &&
    !Array.isArray(incoming)
  ) {
    const out: { [k: string]: Json } = { ...base };
    for (const [k, v] of Object.entries(incoming)) {
      if (k in base) {
        out[k] = deepMergePreferExisting(base[k] as Json, v);
      } else {
        out[k] = v;
      }
    }
    return out;
  }
  if (Array.isArray(base) && Array.isArray(incoming)) {
    const out: Json[] = [...base];
    for (const item of incoming) {
      if (!arrayContainsEntry(out, item)) {
        out.push(item);
      }
    }
    return out;
  }
  // Primitive or mismatched — existing wins.
  return base;
}

/**
 * True when `arr` already contains an entry matching `item`. For
 * objects with a `matcher` field we compare by that key (matches the
 * Claude Code / Codex hook convention); otherwise we fall back to a
 * JSON-string equality check.
 */
function arrayContainsEntry(arr: Json[], item: Json): boolean {
  if (item !== null && typeof item === "object" && !Array.isArray(item)) {
    const matcher = (item as { [k: string]: Json })["matcher"];
    if (typeof matcher === "string") {
      for (const existing of arr) {
        if (
          existing !== null &&
          typeof existing === "object" &&
          !Array.isArray(existing) &&
          (existing as { [k: string]: Json })["matcher"] === matcher
        ) {
          return true;
        }
      }
      return false;
    }
  }
  const target = JSON.stringify(item);
  for (const existing of arr) {
    if (JSON.stringify(existing) === target) {
      return true;
    }
  }
  return false;
}

/**
 * True when `command` is a doc-wiki–managed hook command — one that
 * invokes our `security_check.js` guard with `--wiki-root`. Used to
 * distinguish our own entries (safe to refresh) from user-authored hooks
 * (must never be touched).
 */
function isManagedHookCommand(command: Json | undefined): command is string {
  return (
    typeof command === "string" &&
    command.includes("security_check.js") &&
    command.includes("--wiki-root")
  );
}

/**
 * Refresh the stored command of any pre-existing doc-wiki–managed entry
 * in `target` to match the freshly-built `incoming` entry with the same
 * matcher. `deepMergePreferExisting` skips an incoming entry whenever its
 * matcher already exists, so an install created before a security fix
 * keeps its outdated (e.g. unescaped, injectable) command string. This
 * pass upgrades those in place. Entries whose command does not invoke our
 * `security_check.js` are user-authored and left untouched.
 *
 * Handles both hook shapes:
 *   - Claude Code:   `{ matcher, hooks: [{ type, command }] }`
 *   - Codex/Cursor:  `{ matcher, command }`
 */
function refreshManagedEntries(target: Json | undefined, incoming: Json): void {
  if (!Array.isArray(target) || !Array.isArray(incoming)) return;
  for (const existing of target) {
    if (existing === null || typeof existing !== "object" || Array.isArray(existing)) {
      continue;
    }
    const entry = existing as { [k: string]: Json };
    const matcher = entry["matcher"];
    if (typeof matcher !== "string") continue;
    const fresh = incoming.find(
      (i) =>
        i !== null &&
        typeof i === "object" &&
        !Array.isArray(i) &&
        (i as { [k: string]: Json })["matcher"] === matcher,
    ) as { [k: string]: Json } | undefined;
    if (!fresh) continue;

    // Codex/Cursor shape: top-level command.
    if (isManagedHookCommand(entry["command"]) && typeof fresh["command"] === "string") {
      entry["command"] = fresh["command"];
    }

    // Claude Code shape: nested hooks[].command.
    if (Array.isArray(entry["hooks"]) && Array.isArray(fresh["hooks"])) {
      const freshCmd = (fresh["hooks"] as Json[])
        .map((h) =>
          h !== null && typeof h === "object" && !Array.isArray(h)
            ? (h as { [k: string]: Json })["command"]
            : undefined,
        )
        .find((c): c is string => typeof c === "string");
      if (typeof freshCmd === "string") {
        for (const h of entry["hooks"] as Json[]) {
          if (h !== null && typeof h === "object" && !Array.isArray(h)) {
            const hook = h as { [k: string]: Json };
            if (isManagedHookCommand(hook["command"])) {
              hook["command"] = freshCmd;
            }
          }
        }
      }
    }
  }
}

// ── JSON file I/O ──────────────────────────────────────────────────────

function readJsonFile(filePath: string): Json | null {
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, "utf-8").trim();
  if (raw.length === 0) return null;
  try {
    return JSON.parse(raw) as Json;
  } catch {
    return null;
  }
}

/**
 * Write `contents` to `filePath` only when the serialized form differs
 * from what's already on disk. Returns true when a write occurred.
 * JSON is indented with 2 spaces and a trailing newline, matching the
 * convention used by Claude Code's settings.json.
 */
function writeJsonIfChanged(filePath: string, contents: Json): boolean {
  const serialized = JSON.stringify(contents, null, 2) + "\n";
  if (fs.existsSync(filePath)) {
    const existing = fs.readFileSync(filePath, "utf-8");
    if (existing === serialized) return false;
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, serialized);
  return true;
}

// ── Claude Code installer ──────────────────────────────────────────────

/**
 * Build the Claude Code `hooks.PreToolUse` array that guards wiki I/O.
 *
 * Each entry uses the `{ matcher, hooks: [{ type, command }] }` shape
 * from the Claude Code hooks contract. We ship three matchers:
 *   - `WebFetch`  — block non-http(s) URLs and file-redirect targets
 *   - `WebSearch` — same URL guard applied to search query URLs
 *   - `Write|Edit|MultiEdit` — path-containment check for wiki/raw paths
 */
function claudeCodeHookEntries(wikiRoot: string): Json {
  const cmd = (flag: string) =>
    `node ${escapeShellArg(securityCheckPath())} ${flag} --wiki-root ${escapeShellArg(wikiRoot)}`;
  return [
    {
      matcher: "WebFetch",
      hooks: [{ type: "command", command: cmd("--tool-input-url") }],
    },
    {
      matcher: "WebSearch",
      hooks: [{ type: "command", command: cmd("--tool-input-url") }],
    },
    {
      matcher: "Write|Edit|MultiEdit",
      hooks: [{ type: "command", command: cmd("--tool-input-path") }],
    },
  ];
}

/**
 * Install PreToolUse hooks for Claude Code by merging into
 * `<wikiRoot>/.claude/settings.json`. Preserves any existing
 * non-wiki settings. Returns `installed: false` on a no-op second run.
 */
export function installClaudeCodeHooks(wikiRoot: string): InstallResult {
  const settingsPath = path.join(wikiRoot, ".claude", "settings.json");
  const existing = (readJsonFile(settingsPath) ?? {}) as {
    [k: string]: Json;
  };

  const incoming: Json = {
    hooks: {
      PreToolUse: claudeCodeHookEntries(wikiRoot),
    },
  };

  const merged = deepMergePreferExisting(existing, incoming) as {
    [k: string]: Json;
  };
  const hooks = merged["hooks"];
  if (hooks !== null && typeof hooks === "object" && !Array.isArray(hooks)) {
    refreshManagedEntries(
      (hooks as { [k: string]: Json })["PreToolUse"],
      claudeCodeHookEntries(wikiRoot),
    );
  }
  const installed = writeJsonIfChanged(settingsPath, merged);
  return { installed, settingsPath };
}

// ── Codex installer ────────────────────────────────────────────────────

function codexHookEntries(wikiRoot: string): Json {
  const cmd = (flag: string) =>
    `node ${escapeShellArg(securityCheckPath())} ${flag} --wiki-root ${escapeShellArg(wikiRoot)}`;
  return [
    { matcher: "WebFetch", command: cmd("--tool-input-url") },
    { matcher: "WebSearch", command: cmd("--tool-input-url") },
    { matcher: "Write|Edit|MultiEdit", command: cmd("--tool-input-path") },
  ];
}

export function installCodexHooks(wikiRoot: string): InstallResult {
  const settingsPath = path.join(wikiRoot, ".codex", "hooks.json");
  const existing = (readJsonFile(settingsPath) ?? {}) as {
    [k: string]: Json;
  };

  const incoming: Json = {
    preToolUse: codexHookEntries(wikiRoot),
  };

  const merged = deepMergePreferExisting(existing, incoming) as {
    [k: string]: Json;
  };
  refreshManagedEntries(merged["preToolUse"], codexHookEntries(wikiRoot));
  const installed = writeJsonIfChanged(settingsPath, merged);
  return { installed, settingsPath };
}

// ── Cursor installer ───────────────────────────────────────────────────

function cursorHookEntries(wikiRoot: string): Json {
  const cmd = (flag: string) =>
    `node ${escapeShellArg(securityCheckPath())} ${flag} --wiki-root ${escapeShellArg(wikiRoot)}`;
  return [
    { matcher: "WebFetch", command: cmd("--tool-input-url") },
    { matcher: "WebSearch", command: cmd("--tool-input-url") },
    { matcher: "Write|Edit|MultiEdit", command: cmd("--tool-input-path") },
  ];
}

export function installCursorHooks(wikiRoot: string): InstallResult {
  const settingsPath = path.join(wikiRoot, ".cursor", "hooks.json");
  const existing = (readJsonFile(settingsPath) ?? {}) as {
    [k: string]: Json;
  };

  const incoming: Json = {
    preToolUse: cursorHookEntries(wikiRoot),
  };

  const merged = deepMergePreferExisting(existing, incoming) as {
    [k: string]: Json;
  };
  refreshManagedEntries(merged["preToolUse"], cursorHookEntries(wikiRoot));
  const installed = writeJsonIfChanged(settingsPath, merged);
  return { installed, settingsPath };
}

// ── Aider installer ────────────────────────────────────────────────────

const AIDER_MARKER_START = "# >>> wiki-pre-tool-use (managed) >>>";
const AIDER_MARKER_END = "# <<< wiki-pre-tool-use (managed) <<<";

/**
 * Aider consumes a shell-style hooks file. We write a single managed
 * block between sentinel markers so re-runs replace only our section
 * and leave any user-authored hooks untouched. The block invokes the
 * same `security_check.js` entry point as the JSON-based installers.
 */
function aiderManagedBlock(wikiRoot: string): string {
  const sc = securityCheckPath();
  return [
    AIDER_MARKER_START,
    `# Installed by skills/doc-wiki. Runs before every aider tool use.`,
    `pre_tool_use() {`,
    `  case "$TOOL_NAME" in`,
    `    WebFetch|WebSearch)`,
    `      node ${escapeShellArg(sc)} --tool-input-url --wiki-root ${escapeShellArg(wikiRoot)} || return 1`,
    `      ;;`,
    `    Write|Edit|MultiEdit)`,
    `      node ${escapeShellArg(sc)} --tool-input-path --wiki-root ${escapeShellArg(wikiRoot)} || return 1`,
    `      ;;`,
    `  esac`,
    `}`,
    AIDER_MARKER_END,
  ].join("\n");
}

export function installAiderHooks(wikiRoot: string): InstallResult {
  const settingsPath = path.join(wikiRoot, ".aider", "hooks");
  const existing = fs.existsSync(settingsPath)
    ? fs.readFileSync(settingsPath, "utf-8")
    : "";

  const managed = aiderManagedBlock(wikiRoot);
  let next: string;

  const startIdx = existing.indexOf(AIDER_MARKER_START);
  const endIdx = existing.indexOf(AIDER_MARKER_END);
  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    // Replace in place between markers (keeps user content around block).
    const endLen = AIDER_MARKER_END.length;
    next = existing.slice(0, startIdx) + managed + existing.slice(endIdx + endLen);
  } else if (existing.length === 0) {
    next = managed + "\n";
  } else {
    next = existing.replace(/\s*$/, "") + "\n\n" + managed + "\n";
  }

  if (next === existing) {
    return { installed: false, settingsPath };
  }
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, next);
  return { installed: true, settingsPath };
}
