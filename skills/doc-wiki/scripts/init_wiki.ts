#!/usr/bin/env node
/**
 * init_wiki -- Create the directory scaffold and default config for a
 * documentation wiki.
 *
 * Usage:
 *   node init_wiki.js --path /path/to/wiki-root [--domain general] [--name "My Wiki"]
 *
 * The script is idempotent: existing directories are kept, existing config is
 * not overwritten, and existing wiki files are preserved.
 *
 * This is a TypeScript port of init_wiki.py; stdout JSON, on-disk scaffold,
 * and idempotency semantics match the Python reference byte-for-byte.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as yaml from "js-yaml";
import { parseFlags } from "./_cli_args.js";
import { installClaudeCodeHooks } from "./hook_installer.js";
import { applyCredentialsConfig, mergeCredentialsConfig } from "./apply_config.js";
import { logEvent } from "./event_logger.js";

// ── Constants ───────────────────────────────────────────────────────

const SCAFFOLD_DIRS: readonly string[] = [
  "wiki",
  "wiki/claims",
  "wiki/synthesis",
  "wiki/templates",
  "raw",
  "graph",
  "audit/open",
  "audit/resolved",
  "log/daily",
  "outputs/queries",
  "outputs/reports",
  ".wiki-cache",
];

const WIKI_IGNORE_DEFAULTS: readonly string[] = [
  ".git/",
  "node_modules/",
  ".DS_Store",
];

/** Initial seeded pages under wiki/. Insertion order matches Python's dict
 *  literal so `created_files` lists them in the same order. */
const INITIAL_WIKI_FILES: ReadonlyArray<[string, string]> = [
  ["wiki/index.md", "# Index\n\nWiki entry point.\n"],
  ["wiki/summaries.md", "# Summaries\n\nHigh-level summaries of wiki topics.\n"],
  ["wiki/overview.md", "# Overview\n\nOverview of the knowledge domain.\n"],
];

// ── Helpers ─────────────────────────────────────────────────────────

/**
 * Return the default wiki.config.yaml structure. Shape mirrors the v2
 * design report (`ideal-wiki-skill-report-v2.md` §15). Defaults are
 * copied verbatim from the design spec — do not invent values.
 *
 * Key order is preserved on serialization so a `diff` of two configs
 * produced with the same inputs is byte-stable.
 */
function buildConfig(domain: string, name: string): Record<string, unknown> {
  return {
    // Wiki metadata
    wiki: {
      name,
      domain,
      max_depth: 3,
      ignore_file: ".wiki-ignore",
    },

    // v2 — multi-skill ecosystem
    ecosystem: {
      agents: {
        source: {},          // populated by /doc-wiki:onboard
        custom: [],          // custom source agents — each entry is an AgentManifest:
        // - name: my-agent
        //   source_schemes: ["myscheme://"]
        //   source_url_patterns: [{hostname: "kb.company.com"}]
        //   invocation_template: {subagent_type: my-agent, default_model: haiku, label: "My Agent"}
        model_overrides: {}, // per-agent model overrides
      },
      credentials: {
        provider: "file", // file | env_var | keychain | cloud_secrets
        config: {
          path: "~/.wiki/credentials.json",
        },
      },
      database: {
        enabled: false,
        driver: "sqlite", // postgresql | mysql | sqlite | sqlserver | mongodb | dynamodb
        environments: {},
        policy: {
          block_ddl: true,
          block_privilege: true,
          dml_mode: "present_only",
          escalate_unbounded_reads: true,
        },
        audit: {
          enabled: false,
          path: "~/.wiki/db_audit.jsonl",
        },
      },
      orm: {
        enabled: true,
        profiles: [],
        custom_profiles: [],
        cross_validate_against_db: true,
      },
      claude_md: {
        enabled: true,
        submodule_support: true,
        marked_sections: true,
        preserve_user_sections: true,
      },
      mermaid: {
        auto_generate: true,
        types: ["erDiagram", "sequenceDiagram", "graph"],
        lint_syntax: true,
      },
    },

    autonomy: {
      mode: "balanced",
      overrides: {
        broken_links: "auto_fix",
        missing_frontmatter: "auto_fix",
        contradictions: "human_review",
        stale_content: "suggest",
      },
    },

    sources: {
      providers: {
        file: { type: "static" },
      },
    },

    // Top-level credentials block — consumed by `applyCredentialsConfig()`
    // (see apply_config.ts) which populates the runtime provider registry
    // used by Phase C/D/E code via `resolveSecret()`. `ecosystem.credentials`
    // above mirrors the design §15 sub-block; this top-level block is what
    // the runtime actually reads.
    credentials: {
      provider: "keychain", // keychain | env_var | file | cloud_secrets
      fallback: ["env_var"],
      prefix: "WIKI_",
      // sub_provider is only used when provider === "cloud_secrets".
      // Leave commented here to avoid forcing a cloud dependency at init.
      // sub_provider: "aws",
    },

    // Lint checks + thresholds + auto-fix flags (v2)
    lint: {
      auto_run_after_ingest: true,
      checks: {
        structural: [
          "broken_links",
          "missing_frontmatter",
          "orphan_pages",
          "index_coverage",
          "summaries_sync",
          "mermaid_syntax",
          "orm_mapping_freshness",
        ],
        heuristic: [
          "contradictions",
          "stale_content",
          "terminology_consistency",
          "quality_scoring",
          "claim_confidence_check",
          "anti_repetition_check",
        ],
      },
      auto_fix: {
        broken_links: true,
        missing_frontmatter: true,
      },
      thresholds: {
        thin_cluster_min_pages: 3,
      },
    },

    // Claims provenance & confidence thresholds (v2)
    claims: {
      confidence_range: [0.0, 1.0],
      status_lifecycle: ["proposed", "supported", "challenged", "deprecated"],
      failure_reason_required: true,
    },

    security: {
      url_schemes: ["http", "https"],
      block_file_redirects: true,
      fetch_size_cap_mb: 50,
      fetch_timeout_s: 60,
      path_containment_check: true,
      label_sanitization: {
        strip_control_chars: true,
        max_length: 256,
        html_escape: true,
      },
    },

    // Refs-vs-copies rules and inline-snippet caps (v2)
    code_locality: {
      local_rule: "same_repo_and_readable",
      local_snippet_max_lines: 6,
      external_default: "copy_with_attribution",
      drift_detection: {
        enabled: true,
        on_mismatch: "lint_warning",
      },
    },

    // Source refresh schedule + staleness (v2)
    refresh: {
      stale_threshold: "7d",
      auto_refresh: false,
      keep_history: 3,
      incremental_default: false,
    },

    graph: {
      enabled: true,
      edges_file: "graph/edges.jsonl",
      edge_types: ["supports", "contradicts", "extends", "supersedes"],
      link_format: "markdown",
      provenance: {
        levels: ["EXTRACTED", "INFERRED", "AMBIGUOUS"],
        require_on_every_edge: true,
      },
    },

    cache: {
      enabled: true,
      dir: ".wiki-cache",
    },

    logging: {
      format: "jsonl",
      events_file: "log/events.jsonl",
      daily_summaries: true,
      per_agent_logging: true,
    },

    // Post-operation hooks (v2)
    hooks: {
      crosslink: {
        enabled: true,
        skip_below_pages: 3,
      },
      tag_harmonize: {
        enabled: true,
        min_pages_for_tag: 2,
        content_only: true,
      },
    },

    // Always-on platform hooks — installer targets (v2)
    hooks_always_on: {
      enabled: true,
      phase_1_platforms: {
        claude_code: {
          pre_tool_use_hook: {
            fires_before: ["Glob", "Grep", "Read"],
          },
        },
        codex: {
          pre_tool_use_hook: {
            fires_before: ["Bash"],
          },
        },
        cursor: {
          always_apply: true,
        },
      },
    },

    // Multimodal extraction (v2) — consumed by extract_multimodal.ts
    // via isBinaryOnPath() in _optional.ts. `enabled` accepts
    // "on" | "optional" | "off"; default "optional" = graceful-skip
    // when faster-whisper or yt-dlp are not on PATH.
    multimodal: {
      enabled: "optional",
      vision: {
        extensions: ["png", "jpg", "jpeg", "webp", "gif", "svg"],
      },
      audio_video: {
        extensions: [
          "mp4", "mov", "mkv", "webm", "avi", "m4v",
          "mp3", "wav", "m4a", "ogg",
        ],
        whisper_model: "small",
      },
    },
  };
}

/**
 * Python's `Path(path).resolve()` on macOS collapses `/tmp` into
 * `/private/tmp`. Match that exactly by walking up until we hit an existing
 * prefix, realpath-ing that, then re-joining the missing tail. Returns an
 * absolute, symlink-resolved path even when the target does not yet exist.
 */
function pythonResolve(p: string): string {
  const abs = path.resolve(p);
  try {
    return fs.realpathSync(abs);
  } catch {
    // Walk up until we find an existing ancestor; realpath that, then
    // reattach the missing tail components.
    const missing: string[] = [];
    let current = abs;
    while (true) {
      const parent = path.dirname(current);
      if (parent === current) {
        // Hit the filesystem root.
        return abs;
      }
      missing.unshift(path.basename(current));
      current = parent;
      try {
        const resolved = fs.realpathSync(current);
        return path.join(resolved, ...missing);
      } catch {
        // keep walking up
      }
    }
  }
}

/** Touch (create empty file if missing). Mirrors `Path.touch()`. */
function touchFile(target: string): void {
  const fd = fs.openSync(target, "a");
  fs.closeSync(fd);
}

// ── Main logic ──────────────────────────────────────────────────────

export interface InitResult {
  status: string;
  wiki_root: string;
  created_dirs: string[];
  created_files: string[];
}

/**
 * Create the wiki scaffold at `wikiPath`. Idempotent — re-running on an
 * existing wiki leaves user edits intact and returns empty `created_*`
 * arrays for anything that already existed.
 */
export function initWiki(
  wikiPath: string,
  domain: string = "general",
  name: string = "My Wiki",
): InitResult {
  const root = pythonResolve(wikiPath);

  const createdDirs: string[] = [];
  const createdFiles: string[] = [];

  // 1. Create directories
  for (const d of SCAFFOLD_DIRS) {
    const target = path.join(root, d);
    if (!fs.existsSync(target)) {
      fs.mkdirSync(target, { recursive: true });
      createdDirs.push(d);
    }
  }

  // 2. Write wiki.config.yaml (skip if exists)
  const configPath = path.join(root, "wiki.config.yaml");
  if (!fs.existsSync(configPath)) {
    const config = buildConfig(domain, name);
    // PyYAML(default_flow_style=False, sort_keys=False) emits arrays with no
    // extra indent ("  - item" not "    - item"); js-yaml mirrors that with
    // `noArrayIndent: true`.
    fs.writeFileSync(
      configPath,
      yaml.dump(config, { sortKeys: false, noArrayIndent: true }),
    );
    createdFiles.push("wiki.config.yaml");
  }

  // 3. Create initial wiki files (skip if exists)
  for (const [relPath, content] of INITIAL_WIKI_FILES) {
    const target = path.join(root, relPath);
    if (!fs.existsSync(target)) {
      fs.writeFileSync(target, content);
      createdFiles.push(relPath);
    }
  }

  // 4. Create .wiki-ignore (skip if exists)
  const ignorePath = path.join(root, ".wiki-ignore");
  if (!fs.existsSync(ignorePath)) {
    fs.writeFileSync(ignorePath, WIKI_IGNORE_DEFAULTS.join("\n") + "\n");
    createdFiles.push(".wiki-ignore");
  }

  // 5. Create empty events log (skip if exists)
  const eventsPath = path.join(root, "log", "events.jsonl");
  if (!fs.existsSync(eventsPath)) {
    touchFile(eventsPath);
    createdFiles.push("log/events.jsonl");
  }

  // 6. Create empty edges file (skip if exists)
  const edgesPath = path.join(root, "graph", "edges.jsonl");
  if (!fs.existsSync(edgesPath)) {
    touchFile(edgesPath);
    createdFiles.push("graph/edges.jsonl");
  }

  // 7. Install Claude Code PreToolUse hooks. Other platforms (Codex,
  // Cursor, Aider) are installed by `/doc-wiki:onboard` on demand so a
  // vanilla `/doc-wiki:init` doesn't scribble into workspaces the user
  // may not be using. Idempotent — returns `{installed: false}`
  // without changes when already present.
  const hookResult = installClaudeCodeHooks(root);
  if (hookResult.installed) {
    createdFiles.push(path.relative(root, hookResult.settingsPath));
  }

  // 8. Wire the credential-provider registry from the `credentials`
  // block so downstream Phase C/D/E `resolveSecret()` calls have at
  // least one provider available. Reads the config from disk so a
  // user-edited config is honored on re-init. Merges the top-level
  // `credentials` block with `ecosystem.credentials` (top-level wins)
  // so editing either block gets the expected behavior.
  try {
    const parsed = yaml.load(fs.readFileSync(configPath, "utf-8")) as
      | Record<string, unknown>
      | null;
    const merged = mergeCredentialsConfig(parsed);
    if (merged.provider || (merged.fallback && merged.fallback.length > 0)) {
      applyCredentialsConfig(merged);
    }
  } catch (e) {
    // A user-edited, malformed config shouldn't abort init — but stay
    // loud so the mysterious "no provider" failure in a later op has a
    // breadcrumb back to the real cause.
    console.warn(
      `[wiki] failed to apply credentials config: ${(e as Error).message}`,
    );
  }

  // 9. Audit: record an `init` event so the scaffold shows up in the same
  // events.jsonl stream as ingest/query/lint. Idempotent re-inits still get
  // logged (with empty created_* arrays) — that's desired: every invocation
  // of the operation is observable.
  try {
    logEvent(root, "init", {
      domain,
      name,
      created_dirs: createdDirs,
      created_files: createdFiles,
    });
  } catch (e) {
    console.warn(
      `[wiki] failed to log init event: ${(e as Error).message}`,
    );
  }

  return {
    status: "ok",
    wiki_root: root,
    created_dirs: createdDirs,
    created_files: createdFiles,
  };
}

// ── CLI ─────────────────────────────────────────────────────────────

const FLAG_SPEC = {
  "--path": "path",
  "--domain": "domain",
  "--name": "name",
} as const;

const HELP_TEXT = `usage: init_wiki.js [-h] --path PATH [--domain DOMAIN] [--name NAME]

Initialize a documentation wiki scaffold.

options:
  -h, --help       show this help message and exit
  --path PATH      Root directory for the wiki.
  --domain DOMAIN  Knowledge domain (default: general).
  --name NAME      Display name for the wiki (default: "My Wiki").
`;

export function main(
  argv: readonly string[] = process.argv.slice(2),
): number {
  let parsed: ReturnType<typeof parseFlags>;
  try {
    parsed = parseFlags(argv, FLAG_SPEC);
  } catch (e) {
    process.stderr.write(`${(e as Error).message}\n`);
    return 2;
  }

  if (parsed.help) {
    process.stdout.write(HELP_TEXT);
    return 0;
  }

  const pathArg = parsed.values["path"];
  if (typeof pathArg !== "string" || pathArg === "") {
    process.stderr.write("the following arguments are required: --path\n");
    return 2;
  }
  const domain =
    typeof parsed.values["domain"] === "string" && parsed.values["domain"]
      ? parsed.values["domain"]
      : "general";
  const name =
    typeof parsed.values["name"] === "string" && parsed.values["name"]
      ? parsed.values["name"]
      : "My Wiki";

  const result = initWiki(pathArg, domain, name);
  process.stdout.write(JSON.stringify(result) + "\n");
  return 0;
}

// CLI entry point: run main() when this file is executed directly.
const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === thisFile) {
  process.exit(main());
}
