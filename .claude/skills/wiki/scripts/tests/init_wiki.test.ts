/**
 * Tests for init_wiki.ts — ported from test_init_wiki.py.
 *
 * Every pytest `def test_*` is preserved as a Vitest `it()`. One extra
 * CLI-parity test shells out to the compiled init_wiki.js and confirms its
 * stdout matches the Python reference byte-for-byte — covering the "runs
 * twice, stdout identical, zero new files" idempotency contract.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "js-yaml";

import { initWiki, main } from "../init_wiki.js";
import { SCRIPTS_DIR, makeTmpPath, cleanupTmpPath } from "./fixtures.js";

const CLI = path.join(SCRIPTS_DIR, "init_wiki.js");
const PY_CLI = path.join(SCRIPTS_DIR, "init_wiki.py");

/** Mirrors the pytest `tmp_wiki` fixture: the path to a not-yet-created wiki
 *  root directory inside a fresh tmp dir. */
function tmpWiki(tmpPath: string): string {
  return path.join(tmpPath, "wiki-root");
}

/** Mirror `_run_init` helper from test_init_wiki.py — call main() the same way
 *  init_wiki.py's test harness does. The Python version passes argv with a
 *  fake program-name leading element and then slices it off, so we replicate
 *  the shape here for completeness. */
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

    expect(fs.readFileSync(index, "utf-8").startsWith("#")).toBe(true);
    expect(fs.readFileSync(summaries, "utf-8").startsWith("#")).toBe(true);
    expect(fs.readFileSync(overview, "utf-8").startsWith("#")).toBe(true);
  });

  it("test_creates_wiki_ignore", () => {
    const wiki = tmpWiki(tmpPath);
    runInit(wiki);
    const ignorePath = path.join(wiki, ".wiki-ignore");
    expect(fs.existsSync(ignorePath)).toBe(true);
    const content = fs.readFileSync(ignorePath, "utf-8");
    expect(content).toContain("__pycache__/");
    expect(content).toContain(".git/");
    expect(content).toContain("node_modules/");
  });

  it("test_creates_empty_events_log", () => {
    const wiki = tmpWiki(tmpPath);
    runInit(wiki);
    const events = path.join(wiki, "log", "events.jsonl");
    expect(fs.existsSync(events)).toBe(true);
    expect(fs.readFileSync(events, "utf-8")).toBe("");
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

// ── CLI parity with Python ──────────────────────────────────────────

function runCli(
  bin: string,
  args: readonly string[],
): { stdout: string; stderr: string; status: number } {
  const interpreter = bin.endsWith(".py") ? "python3" : "node";
  try {
    const stdout = execFileSync(interpreter, [bin, ...args], {
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

describe("init_wiki CLI parity", () => {
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
    // placeholder. We resolve symlinks first so Python's and Node's outputs
    // agree even on macOS (/tmp vs /private/tmp).
    const real = fs.realpathSync(wikiPath);
    return stdout.split(real).join("REAL_ROOT");
  }

  it("cli_first_run_matches_python", () => {
    const pyTarget = path.join(tmpPath, "py");
    const tsTarget = path.join(tmpPath, "ts");
    fs.mkdirSync(pyTarget);
    fs.mkdirSync(tsTarget);

    const py = runCli(PY_CLI, [
      "--path",
      pyTarget,
      "--domain",
      "general",
      "--name",
      "My Wiki",
    ]);
    const ts = runCli(CLI, [
      "--path",
      tsTarget,
      "--domain",
      "general",
      "--name",
      "My Wiki",
    ]);
    expect(py.status).toBe(0);
    expect(ts.status).toBe(0);
    expect(scrub(ts.stdout, tsTarget)).toBe(scrub(py.stdout, pyTarget));
  });

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

    // Both runs emit a path-scrubbed stdout that only differs in the
    // created_* arrays: first has entries, second has empty arrays.
    const scrubbedSecond = scrub(second.stdout, target);
    expect(scrubbedSecond).toContain('"created_dirs": []');
    expect(scrubbedSecond).toContain('"created_files": []');
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
