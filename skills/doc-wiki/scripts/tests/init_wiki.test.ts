/**
 * Tests for init_wiki.ts — originally ported from test_init_wiki.py and now
 * the sole test source after Python removal. Covers the unit API and a CLI
 * idempotency contract ("runs twice, stdout identical, zero new files").
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "js-yaml";

import { initWiki, main } from "../init_wiki.js";
import { SCRIPTS_DIR, makeTmpPath, cleanupTmpPath } from "./fixtures.js";

const CLI = path.join(SCRIPTS_DIR, "init_wiki.js");

/** Mirrors the pytest `tmp_wiki` fixture: the path to a not-yet-created wiki
 *  root directory inside a fresh tmp dir. */
function tmpWiki(tmpPath: string): string {
  return path.join(tmpPath, "wiki-root");
}

/** Helper that invokes the unit `main()` entry point with argv shaped the
 *  same way the CLI receives it (program-name leading element gets sliced
 *  off internally). */
function runInit(
  wikiPath: string,
  domain: string = "general",
  name: string = "My Wiki",
): void {
  const rc = main([
    "--path",
    wikiPath,
    "--domain",
    domain,
    "--name",
    name,
  ]);
  expect(rc).toBe(0);
}

// ── Expected directory scaffold ─────────────────────────────────────

const EXPECTED_DIRS = [
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

describe("init_wiki — directory scaffold", () => {
  let tmpPath: string;
  beforeEach(() => {
    tmpPath = makeTmpPath("init-wiki-dirs-");
  });
  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("test_creates_directory_scaffold", () => {
    const wiki = tmpWiki(tmpPath);
    runInit(wiki);
    for (const d of EXPECTED_DIRS) {
      const full = path.join(wiki, d);
      expect(fs.existsSync(full), `Missing directory: ${d}`).toBe(true);
      expect(fs.statSync(full).isDirectory()).toBe(true);
    }
  });
});

// ── wiki.config.yaml ────────────────────────────────────────────────

describe("init_wiki — wiki.config.yaml", () => {
  let tmpPath: string;
  beforeEach(() => {
    tmpPath = makeTmpPath("init-wiki-config-");
  });
  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("test_creates_wiki_config_yaml", () => {
    const wiki = tmpWiki(tmpPath);
    runInit(wiki);
    const cfgPath = path.join(wiki, "wiki.config.yaml");
    expect(fs.existsSync(cfgPath)).toBe(true);

    const parsed = yaml.load(fs.readFileSync(cfgPath, "utf-8")) as Record<
      string,
      Record<string, unknown>
    >;
    expect(parsed["wiki"]?.["domain"]).toBe("general");
    expect(parsed["wiki"]?.["name"]).toBe("My Wiki");
    expect(parsed["wiki"]?.["max_depth"]).toBe(3);
    expect("ignore_file" in (parsed["wiki"] ?? {})).toBe(true);
  });
});

// ── initial wiki files ──────────────────────────────────────────────

describe("init_wiki — initial files", () => {
  let tmpPath: string;
  beforeEach(() => {
    tmpPath = makeTmpPath("init-wiki-files-");
  });
  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("test_creates_initial_wiki_files", () => {
    const wiki = tmpWiki(tmpPath);
    runInit(wiki);

    const index = path.join(wiki, "wiki", "index.md");
    const summaries = path.join(wiki, "wiki", "summaries.md");
    const overview = path.join(wiki, "wiki", "overview.md");

    expect(fs.existsSync(index)).toBe(true);
    expect(fs.existsSync(summaries)).toBe(true);
    expect(fs.existsSync(overview)).toBe(true);

    // Each seeded page now opens with YAML frontmatter so /doc-wiki:lint
    // does not flag them as `missing_frontmatter` on a fresh wiki.
    for (const p of [index, summaries, overview]) {
      const body = fs.readFileSync(p, "utf-8");
      expect(body.startsWith("---\n"), `${p} should start with frontmatter`).toBe(true);
      // Required compilation.md fields plus the audience field added in the
      // audience-aware-coverage tranche.
      for (const field of [
        "title:",
        "type:",
        "tags:",
        "sources:",
        "created:",
        "updated:",
        "quality:",
        "summary:",
        "audience:",
      ]) {
        expect(body, `${p} should declare ${field}`).toContain(field);
      }
      // The body heading is preserved after the closing frontmatter delimiter.
      expect(body, `${p} should still carry its # heading`).toMatch(/^---\n[\s\S]+?\n---\n\n# /);
    }
  });

  it("test_seed_date_param_overrides_today", () => {
    // initWiki accepts a fixed seedDate so test snapshots are byte-stable.
    const wiki = tmpWiki(tmpPath);
    initWiki(wiki, "general", "My Wiki", "2026-01-15");
    const body = fs.readFileSync(path.join(wiki, "wiki", "index.md"), "utf-8");
    expect(body).toContain('created: "2026-01-15"');
    expect(body).toContain('updated: "2026-01-15"');
  });

  it("test_seeded_frontmatter_parses_to_valid_yaml", () => {
    const wiki = tmpWiki(tmpPath);
    runInit(wiki);
    for (const name of ["index.md", "summaries.md", "overview.md"]) {
      const body = fs.readFileSync(path.join(wiki, "wiki", name), "utf-8");
      // Extract the frontmatter block (between the two `---` delimiters)
      // and verify it parses as a YAML object with the required scalar
      // and list fields populated.
      const match = body.match(/^---\n([\s\S]*?)\n---\n/);
      expect(match, `${name} frontmatter delimiters`).toBeTruthy();
      const fm = yaml.load(match![1] as string) as Record<string, unknown>;
      expect(fm["title"]).toBeTypeOf("string");
      expect(fm["type"]).toBeTypeOf("string");
      expect(Array.isArray(fm["tags"])).toBe(true);
      expect(Array.isArray(fm["sources"])).toBe(true);
      expect((fm["sources"] as string[]).length).toBeGreaterThan(0);
      expect(fm["created"]).toMatch(/^\d{4}-\d{2}-\d{2}/);
      expect(fm["updated"]).toMatch(/^\d{4}-\d{2}-\d{2}/);
      expect(fm["quality"]).toBe(0);
      expect(fm["summary"]).toBeTypeOf("string");
      expect(fm["audience"]).toBe("contributor");
    }
  });

  it("test_creates_wiki_ignore", () => {
    const wiki = tmpWiki(tmpPath);
    runInit(wiki);
    const ignorePath = path.join(wiki, ".wiki-ignore");
    expect(fs.existsSync(ignorePath)).toBe(true);
    const content = fs.readFileSync(ignorePath, "utf-8");
    expect(content).toContain(".git/");
    expect(content).toContain("node_modules/");
    expect(content).toContain(".DS_Store");
    // Python artifacts removed post-TypeScript migration.
    expect(content).not.toContain("__pycache__/");
    expect(content).not.toContain("*.pyc");
  });

  it("test_events_log_records_init_op", () => {
    // /doc-wiki:init emits a single `op: init` event so the scaffold shows up in
    // the same audit stream as ingest/query/lint. Earlier behaviour left
    // events.jsonl empty after init; the updated contract records the op.
    const wiki = tmpWiki(tmpPath);
    runInit(wiki);
    const events = path.join(wiki, "log", "events.jsonl");
    expect(fs.existsSync(events)).toBe(true);
    const raw = fs.readFileSync(events, "utf-8").trim();
    const lines = raw.split("\n").filter((l) => l.length > 0);
    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0] as string);
    expect(entry.op).toBe("init");
    expect(entry.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(Array.isArray(entry.created_dirs)).toBe(true);
    expect(Array.isArray(entry.created_files)).toBe(true);
  });

  it("test_creates_empty_edges_file", () => {
    const wiki = tmpWiki(tmpPath);
    runInit(wiki);
    const edges = path.join(wiki, "graph", "edges.jsonl");
    expect(fs.existsSync(edges)).toBe(true);
    expect(fs.readFileSync(edges, "utf-8")).toBe("");
  });
});

// ── idempotency ─────────────────────────────────────────────────────

describe("init_wiki — idempotency", () => {
  let tmpPath: string;
  beforeEach(() => {
    tmpPath = makeTmpPath("init-wiki-idem-");
  });
  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("test_idempotent_reinit", () => {
    const wiki = tmpWiki(tmpPath);
    runInit(wiki);

    // Write custom content into an existing file
    const marker = "DO NOT DESTROY THIS LINE";
    fs.writeFileSync(
      path.join(wiki, "wiki", "index.md"),
      `# Custom\n${marker}\n`,
    );
    fs.writeFileSync(
      path.join(wiki, "wiki.config.yaml"),
      yaml.dump({ wiki: { name: "Custom Wiki", domain: "custom" } }),
    );

    // Re-init
    runInit(wiki);

    expect(fs.readFileSync(path.join(wiki, "wiki", "index.md"), "utf-8")).toContain(
      marker,
    );
    const cfg = yaml.load(
      fs.readFileSync(path.join(wiki, "wiki.config.yaml"), "utf-8"),
    ) as Record<string, Record<string, unknown>>;
    expect(cfg["wiki"]?.["name"]).toBe("Custom Wiki");
  });

  it("second_run_returns_empty_created_arrays", () => {
    // Beyond the Python port: confirm the library API reports no new files
    // on the second run, so parent tools can trust created_* length==0 as an
    // idempotent-success indicator.
    const wiki = tmpWiki(tmpPath);
    initWiki(wiki);
    const second = initWiki(wiki);
    expect(second.created_dirs).toEqual([]);
    expect(second.created_files).toEqual([]);
  });
});

// ── custom domain and name ──────────────────────────────────────────

describe("init_wiki — custom args", () => {
  let tmpPath: string;
  beforeEach(() => {
    tmpPath = makeTmpPath("init-wiki-custom-");
  });
  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("test_custom_domain_and_name", () => {
    const wiki = tmpWiki(tmpPath);
    runInit(wiki, "biology", "Bio Notes");
    const cfg = yaml.load(
      fs.readFileSync(path.join(wiki, "wiki.config.yaml"), "utf-8"),
    ) as Record<string, Record<string, unknown>>;
    expect(cfg["wiki"]?.["domain"]).toBe("biology");
    expect(cfg["wiki"]?.["name"]).toBe("Bio Notes");
  });
});

// ── missing --path ──────────────────────────────────────────────────

describe("init_wiki — missing args", () => {
  it("test_missing_path_returns_nonzero", () => {
    // Python: `pytest.raises(SystemExit)`. Our main() returns a non-zero exit
    // code rather than calling process.exit() directly — confirm rc != 0.
    const rc = main([]);
    expect(rc).not.toBe(0);
  });
});

// ── v2 config blocks (Phase H2) ─────────────────────────────────────

describe("init_wiki — v2 config blocks", () => {
  let tmpPath: string;
  beforeEach(() => {
    tmpPath = makeTmpPath("init-wiki-v2cfg-");
  });
  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  function loadCfg(wiki: string): Record<string, any> {
    return yaml.load(
      fs.readFileSync(path.join(wiki, "wiki.config.yaml"), "utf-8"),
    ) as Record<string, any>;
  }

  it("emits the ecosystem block with agents/credentials/database/orm/claude_md/readme/mermaid", () => {
    const wiki = tmpWiki(tmpPath);
    runInit(wiki);
    const cfg = loadCfg(wiki);

    expect(cfg.ecosystem).toBeDefined();
    expect(cfg.ecosystem.agents).toBeDefined();
    expect(cfg.ecosystem.credentials).toBeDefined();
    expect(cfg.ecosystem.credentials.provider).toBe("file");
    expect(cfg.ecosystem.database).toBeDefined();
    expect(cfg.ecosystem.database.policy.block_ddl).toBe(true);
    expect(cfg.ecosystem.database.policy.dml_mode).toBe("present_only");
    expect(cfg.ecosystem.orm.enabled).toBe(true);
    expect(cfg.ecosystem.rest).toBeDefined();
    expect(cfg.ecosystem.rest.enabled).toBe(false);
    expect(cfg.ecosystem.rest.custom_profiles).toEqual([]);
    expect(cfg.ecosystem.claude_md.enabled).toBe(true);
    expect(cfg.ecosystem.mermaid.auto_generate).toBe(true);
    expect(cfg.ecosystem.mermaid.types).toContain("erDiagram");
  });

  it("emits the lint block with structural and heuristic checks", () => {
    const wiki = tmpWiki(tmpPath);
    runInit(wiki);
    const cfg = loadCfg(wiki);

    expect(cfg.lint).toBeDefined();
    expect(cfg.lint.auto_run_after_ingest).toBe(true);
    expect(cfg.lint.checks.structural).toContain("broken_links");
    expect(cfg.lint.checks.structural).toContain("mermaid_syntax");
    expect(cfg.lint.checks.structural).toContain("orm_mapping_freshness");
    expect(cfg.lint.checks.heuristic).toContain("claim_confidence_check");
    expect(cfg.lint.auto_fix.broken_links).toBe(true);
    expect(cfg.lint.thresholds.thin_cluster_min_pages).toBe(3);
  });

  it("emits the claims block with provenance rules and thresholds", () => {
    const wiki = tmpWiki(tmpPath);
    runInit(wiki);
    const cfg = loadCfg(wiki);

    expect(cfg.claims).toBeDefined();
    expect(cfg.claims.confidence_range).toEqual([0.0, 1.0]);
    expect(cfg.claims.status_lifecycle).toContain("proposed");
    expect(cfg.claims.status_lifecycle).toContain("deprecated");
    expect(cfg.claims.failure_reason_required).toBe(true);
  });

  it("emits the code_locality block", () => {
    const wiki = tmpWiki(tmpPath);
    runInit(wiki);
    const cfg = loadCfg(wiki);

    expect(cfg.code_locality).toBeDefined();
    expect(cfg.code_locality.local_rule).toBe("same_repo_and_readable");
    expect(cfg.code_locality.local_snippet_max_lines).toBe(6);
    expect(cfg.code_locality.external_default).toBe("copy_with_attribution");
    expect(cfg.code_locality.drift_detection.enabled).toBe(true);
  });

  it("emits the refresh block with schedule and staleness", () => {
    const wiki = tmpWiki(tmpPath);
    runInit(wiki);
    const cfg = loadCfg(wiki);

    expect(cfg.refresh).toBeDefined();
    expect(cfg.refresh.stale_threshold).toBe("7d");
    expect(cfg.refresh.auto_refresh).toBe(false);
    expect(cfg.refresh.keep_history).toBe(3);
  });

  it("emits hooks and hooks_always_on blocks", () => {
    const wiki = tmpWiki(tmpPath);
    runInit(wiki);
    const cfg = loadCfg(wiki);

    expect(cfg.hooks).toBeDefined();
    expect(cfg.hooks.crosslink.enabled).toBe(true);
    expect(cfg.hooks.tag_harmonize.enabled).toBe(true);

    expect(cfg.hooks_always_on).toBeDefined();
    expect(cfg.hooks_always_on.enabled).toBe(true);
    expect(cfg.hooks_always_on.phase_1_platforms.claude_code).toBeDefined();
    expect(cfg.hooks_always_on.phase_1_platforms.codex).toBeDefined();
    expect(cfg.hooks_always_on.phase_1_platforms.cursor).toBeDefined();
  });

  it("emits the multimodal block with vision and audio_video", () => {
    const wiki = tmpWiki(tmpPath);
    runInit(wiki);
    const cfg = loadCfg(wiki);

    expect(cfg.multimodal).toBeDefined();
    expect(cfg.multimodal.enabled).toBe("optional");
    expect(cfg.multimodal.vision.extensions).toContain("png");
    expect(cfg.multimodal.audio_video.extensions).toContain("mp4");
    expect(cfg.multimodal.audio_video.whisper_model).toBe("small");
  });

  it("emits the top-level credentials block with provider/fallback/prefix", () => {
    const wiki = tmpWiki(tmpPath);
    runInit(wiki);
    const cfg = loadCfg(wiki);

    expect(cfg.credentials).toBeDefined();
    expect(cfg.credentials.provider).toBe("keychain");
    expect(cfg.credentials.fallback).toEqual(["env_var"]);
    expect(cfg.credentials.prefix).toBe("WIKI_");
  });
});

// ── ecosystem.readme defaults ────────────────────────────────────────

describe("init_wiki — ecosystem.readme defaults", () => {
  let tmpPath: string;
  beforeEach(() => {
    tmpPath = makeTmpPath("init-wiki-readme-");
  });
  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  function loadCfg(wiki: string): Record<string, any> {
    return yaml.load(
      fs.readFileSync(path.join(wiki, "wiki.config.yaml"), "utf-8"),
    ) as Record<string, any>;
  }

  it("includes the readme block with documented defaults", () => {
    const wiki = tmpWiki(tmpPath);
    runInit(wiki);
    const cfg = loadCfg(wiki);
    // salvage_mode is intentionally not seeded — it inherits from
    // autonomy.mode at parse time (applyReadmeDefaults).
    expect(cfg.ecosystem.readme).toEqual({
      enabled: true,
      quickstart_depth: "generous",
      insert_markers_on_init: true,
    });
  });

  it("omits salvage_mode so it inherits from autonomy.mode dynamically", () => {
    const wiki = tmpWiki(tmpPath);
    runInit(wiki);
    const cfg = loadCfg(wiki);
    expect(cfg.ecosystem.readme).not.toHaveProperty("salvage_mode");
  });
});

// ── Claude Code hook install on init (Phase H1) ─────────────────────

describe("init_wiki — Claude Code hook install", () => {
  let tmpPath: string;
  beforeEach(() => {
    tmpPath = makeTmpPath("init-wiki-hooks-");
  });
  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("installs .claude/settings.json PreToolUse hooks on first run", () => {
    const wiki = tmpWiki(tmpPath);
    runInit(wiki);
    const settings = path.join(wiki, ".claude", "settings.json");
    expect(fs.existsSync(settings)).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(settings, "utf-8"));
    expect(parsed.hooks.PreToolUse).toBeDefined();
    const matchers = parsed.hooks.PreToolUse.map(
      (e: { matcher: string }) => e.matcher,
    );
    expect(matchers).toContain("WebFetch");
    expect(matchers).toContain("WebSearch");
  });

  it("re-init does not rewrite hook settings", () => {
    const wiki = tmpWiki(tmpPath);
    runInit(wiki);
    const settings = path.join(wiki, ".claude", "settings.json");
    const before = fs.readFileSync(settings, "utf-8");

    runInit(wiki);
    const after = fs.readFileSync(settings, "utf-8");
    expect(after).toBe(before);

    // Second library call reports no new files from the hook installer.
    const second = initWiki(wiki);
    expect(second.created_files).toEqual([]);
  });
});

// ── credential registry wiring (Phase H credential integration) ─────

describe("init_wiki — credential registry wiring", () => {
  let tmpPath: string;
  beforeEach(() => {
    tmpPath = makeTmpPath("init-wiki-creds-");
  });
  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("populates the credential_providers registry from the emitted config", async () => {
    const { clearProviders, listProviders } = await import(
      "narai-primitives/credentials"
    );
    clearProviders();

    const wiki = tmpWiki(tmpPath);
    initWiki(wiki);

    const names = listProviders();
    // Default config uses primary=keychain, fallback=[env_var]
    expect(names).toContain("keychain");
    expect(names).toContain("env_var");
  });

  it("honors ecosystem.credentials when the top-level block is absent", async () => {
    const { clearProviders, listProviders } = await import(
      "narai-primitives/credentials"
    );
    const wiki = tmpWiki(tmpPath);
    initWiki(wiki);

    // User edits: removes the top-level block and sets provider via
    // ecosystem.credentials only.
    const cfgPath = path.join(wiki, "wiki.config.yaml");
    const cfg = yaml.load(fs.readFileSync(cfgPath, "utf-8")) as Record<
      string,
      any
    >;
    delete cfg["credentials"];
    cfg["ecosystem"]["credentials"] = { provider: "file" };
    fs.writeFileSync(cfgPath, yaml.dump(cfg));

    clearProviders();
    initWiki(wiki); // re-init reads the edited config
    expect(listProviders()).toContain("file");
  });

  it("emits a stderr warning when the config is malformed", async () => {
    const { clearProviders } = await import(
      "narai-primitives/credentials"
    );
    const wiki = tmpWiki(tmpPath);
    initWiki(wiki);

    fs.writeFileSync(path.join(wiki, "wiki.config.yaml"), "not: valid: yaml:");
    clearProviders();

    const messages: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      messages.push(args.map(String).join(" "));
    };
    try {
      initWiki(wiki);
    } finally {
      console.warn = originalWarn;
    }
    expect(messages.some((m) => m.includes("failed to apply credentials"))).toBe(
      true,
    );
  });
});

// ── CLI idempotency ─────────────────────────────────────────────────

function runCli(
  bin: string,
  args: readonly string[],
): { stdout: string; stderr: string; status: number } {
  try {
    const stdout = execFileSync("node", [bin, ...args], {
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
      stdout:
        typeof err.stdout === "string"
          ? err.stdout
          : (err.stdout?.toString("utf-8") ?? ""),
      stderr:
        typeof err.stderr === "string"
          ? err.stderr
          : (err.stderr?.toString("utf-8") ?? ""),
      status: err.status ?? 1,
    };
  }
}

describe("init_wiki CLI idempotency", () => {
  let tmpPath: string;
  beforeEach(() => {
    tmpPath = makeTmpPath("init-wiki-cli-");
  });
  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  /** Scrub the randomized wiki_root path out of stdout before comparing. */
  function scrub(stdout: string, wikiPath: string): string {
    // The path.resolve/realpath output differs per-run, so swap it for a
    // placeholder. We resolve symlinks first so output is stable across
    // runs even on macOS (/tmp vs /private/tmp).
    const real = fs.realpathSync(wikiPath);
    return stdout.split(real).join("REAL_ROOT");
  }

  it("cli_second_run_byte_identical_no_new_files", () => {
    const target = path.join(tmpPath, "wiki");
    fs.mkdirSync(target);

    const first = runCli(CLI, ["--path", target]);
    expect(first.status).toBe(0);
    const filesAfterFirst = listAllFiles(target).sort();

    const second = runCli(CLI, ["--path", target]);
    expect(second.status).toBe(0);
    const filesAfterSecond = listAllFiles(target).sort();

    // Idempotency: re-running the CLI leaves the filesystem untouched.
    expect(filesAfterSecond).toEqual(filesAfterFirst);

    // The second run emits a path-scrubbed stdout whose created_* arrays
    // are empty (first run populated them, second has nothing to do).
    const scrubbedSecond = scrub(second.stdout, target);
    expect(scrubbedSecond).toContain('"created_dirs":[]');
    expect(scrubbedSecond).toContain('"created_files":[]');
  });
});

/** List all files recursively under `root`, relative to it. */
function listAllFiles(root: string): string[] {
  const out: string[] = [];
  const stack: string[] = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    if (dir === undefined) continue;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile()) out.push(path.relative(root, full));
    }
  }
  return out;
}
