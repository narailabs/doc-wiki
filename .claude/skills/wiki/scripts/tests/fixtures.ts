/**
 * Shared fixtures for wiki skill script tests.
 *
 * This is the TypeScript port of conftest.py. Fixtures are exposed as plain
 * helper functions that Vitest tests can invoke inside beforeEach/beforeAll,
 * instead of as pytest's magic function-name auto-wiring.
 *
 * Exports (extended per phase):
 *  - `SCRIPTS_DIR` — absolute path to .claude/skills/wiki/scripts/
 *  - `makeTmpPath` / `cleanupTmpPath` — pytest `tmp_path`-equivalent
 *  - `writeConfigYaml` — write a dumped YAML config at tmpPath
 *  - `makeEmptyEdgesFile` / `makePopulatedEdgesFile` — graph_ops fixtures
 *  - `makeInitializedWiki` — scaffold a wiki root with the Python-expected tree
 *  - `makeWikiWithPages` — initialized wiki plus sample pages for lint/mermaid
 *
 * Test-local seeders (one-shot event logs, per-test mermaid pages, etc.) live
 * next to the tests that use them rather than in this shared module.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as yaml from "js-yaml";

/** Resolve the absolute path to the scripts directory (parent of tests/).
 *  Compiled .js files sit next to their .ts siblings, so the same path
 *  works for both source imports and CLI invocations. */
export const SCRIPTS_DIR = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
);

/**
 * Create a fresh temp directory for a single test and return its path.
 * Analogous to pytest's built-in `tmp_path` fixture.
 */
export function makeTmpPath(prefix: string = "wiki-test-"): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/**
 * Remove a temp directory (best-effort). Safe to call on nonexistent paths.
 */
export function cleanupTmpPath(p: string): void {
  try {
    fs.rmSync(p, { recursive: true, force: true });
  } catch {
    // best-effort
  }
}

/**
 * Return the path to a temp file containing a dumped YAML config.
 * Mirrors the per-test `valid_config_yaml`/`minimal_config_yaml` fixtures
 * in test_parse_config.py.
 */
export function writeConfigYaml(
  tmpPath: string,
  config: Record<string, unknown>,
  filename: string = "wiki.config.yaml",
): string {
  const p = path.join(tmpPath, filename);
  fs.writeFileSync(p, yaml.dump(config));
  return p;
}

/**
 * Create a fresh, empty edges.jsonl inside `tmpPath` and return its path.
 * Mirrors the `edges_file` pytest fixture.
 */
export function makeEmptyEdgesFile(tmpPath: string): string {
  const p = path.join(tmpPath, "edges.jsonl");
  fs.writeFileSync(p, "");
  return p;
}

/**
 * Populate an edges.jsonl at `tmpPath/edges.jsonl` with the small fixture
 * graph used by graph_ops tests, and return its path. Mirrors the
 * `populated_edges` pytest fixture.
 *
 * Topology:
 *   A -> B -> C -> D
 *   A -> E -> D
 *   E -> F
 */
export function makePopulatedEdgesFile(tmpPath: string): string {
  const edges = [
    { from: "A", to: "B", type: "extends", provenance: "EXTRACTED",
      evidence: "", source_file: "", date: "2026-04-10" },
    { from: "B", to: "C", type: "extends", provenance: "EXTRACTED",
      evidence: "", source_file: "", date: "2026-04-10" },
    { from: "C", to: "D", type: "extends", provenance: "EXTRACTED",
      evidence: "", source_file: "", date: "2026-04-10" },
    { from: "A", to: "E", type: "supports", provenance: "INFERRED",
      evidence: "", source_file: "", date: "2026-04-10" },
    { from: "E", to: "D", type: "extends", provenance: "EXTRACTED",
      evidence: "", source_file: "", date: "2026-04-10" },
    { from: "E", to: "F", type: "contradicts", provenance: "AMBIGUOUS",
      evidence: "", source_file: "", date: "2026-04-10" },
  ];
  const p = path.join(tmpPath, "edges.jsonl");
  fs.writeFileSync(
    p,
    edges.map((e) => JSON.stringify(e)).join("\n") + "\n",
  );
  return p;
}

/**
 * Create a fully initialized wiki directory structure rooted at
 * `<tmpPath>/wiki-root`. Mirrors conftest.py's `initialized_wiki` fixture:
 * creates all standard subdirectories, a minimal `wiki.config.yaml`, three
 * starter markdown pages, an empty ignore file, and empty log/graph JSONL
 * files. Returns the absolute path to the wiki root.
 */
export function makeInitializedWiki(tmpPath: string): string {
  const wikiRoot = path.join(tmpPath, "wiki-root");
  const dirs = [
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
  for (const d of dirs) {
    fs.mkdirSync(path.join(wikiRoot, d), { recursive: true });
  }

  const config = {
    wiki: { name: "Test Wiki", domain: "testing", max_depth: 3 },
    autonomy: { mode: "balanced" },
  };
  fs.writeFileSync(path.join(wikiRoot, "wiki.config.yaml"), yaml.dump(config));

  fs.writeFileSync(path.join(wikiRoot, "wiki", "index.md"), "# Test Wiki Index\n");
  fs.writeFileSync(path.join(wikiRoot, "wiki", "summaries.md"), "# Summaries\n");
  fs.writeFileSync(path.join(wikiRoot, "wiki", "overview.md"), "# Overview\n");
  fs.writeFileSync(path.join(wikiRoot, ".wiki-ignore"), "__pycache__/\n.git/\n");

  fs.writeFileSync(path.join(wikiRoot, "log", "events.jsonl"), "");
  fs.writeFileSync(path.join(wikiRoot, "graph", "edges.jsonl"), "");

  return wikiRoot;
}

/**
 * Extend an initialized wiki with the 5 fixture pages + populated edges.jsonl
 * used by `wiki_with_pages` in conftest.py. Mermaid-lint tests only need the
 * single valid mermaid block in `wiki/auth/session.md`, but the full fixture
 * is ported here to keep the TS and Py behaviour aligned for future phases.
 */
export function makeWikiWithPages(tmpPath: string): string {
  const wikiRoot = makeInitializedWiki(tmpPath);
  const wikiDir = path.join(wikiRoot, "wiki");
  fs.mkdirSync(path.join(wikiDir, "auth"), { recursive: true });
  fs.mkdirSync(path.join(wikiDir, "db"), { recursive: true });

  const bodyWords = new Array(150).fill("word").join(" ");
  fs.writeFileSync(
    path.join(wikiDir, "auth", "session.md"),
    "---\n" +
      yaml.dump({
        title: "Session Management",
        type: "concept",
        tags: ["authentication", "jwt", "session-management", "security"],
        sources: ["raw/auth/overview.md"],
        created: "2026-04-12",
        updated: "2026-04-12",
        quality: 0.0,
        summary: "How session management works in the auth system.",
      }) +
      "---\n\n" +
      `# Session Management\n\n${bodyWords}\n\n` +
      "See also [JWT tokens](jwt.md) and [DB schema](../db/schema.md) " +
      "and [overview](../index.md).\n\n" +
      "```mermaid\nsequenceDiagram\n    Client->>Server: Login\n    Server-->>Client: Token\n```\n",
  );

  fs.writeFileSync(
    path.join(wikiDir, "auth", "jwt.md"),
    "---\n" +
      yaml.dump({
        type: "concept",
        tags: ["jwt"],
        sources: ["raw/auth/jwt-spec.md"],
        created: "2026-04-12",
        updated: "2026-04-12",
        quality: 0.0,
        summary: "JWT token format and validation.",
      }) +
      "---\n\nJWT tokens are used for stateless auth. " +
      new Array(60).fill("content").join(" ") +
      "\n",
  );

  fs.writeFileSync(
    path.join(wikiDir, "db", "schema.md"),
    "---\n" +
      yaml.dump({
        title: "Database Schema",
        type: "entity",
        tags: ["database", "schema"],
        sources: [],
        created: "2026-04-12",
        updated: "2026-04-12",
        quality: 0.0,
        summary: "Core database schema for the application.",
      }) +
      "---\n\nThe database schema includes users and orders tables. " +
      new Array(80).fill("detail").join(" ") +
      "\n",
  );

  fs.writeFileSync(
    path.join(wikiDir, "orphan.md"),
    "---\n" +
      yaml.dump({
        title: "Orphan Page",
        type: "concept",
        tags: ["orphan-test"],
        sources: ["raw/misc/orphan.md"],
        created: "2026-04-12",
        updated: "2026-04-12",
        quality: 0.0,
        summary: "This page is not linked from anywhere.",
      }) +
      "---\n\nThis is an orphan page with no incoming links. " +
      new Array(40).fill("filler").join(" ") +
      "\n",
  );

  fs.writeFileSync(
    path.join(wikiDir, "broken.md"),
    "---\n" +
      yaml.dump({
        title: "Page With Broken Links",
        type: "concept",
        tags: ["testing"],
        sources: ["raw/test/broken.md"],
        created: "2026-04-12",
        updated: "2026-04-12",
        quality: 0.0,
        summary: "A page containing broken links for testing.",
      }) +
      "---\n\nSee [missing page](wiki/nonexistent.md) and " +
      "[also missing](wiki/gone.md).\n",
  );

  fs.writeFileSync(
    path.join(wikiDir, "index.md"),
    "# Test Wiki Index\n\n" +
      "- [Session Management](auth/session.md)\n" +
      "- [JWT](auth/jwt.md)\n" +
      "- [DB Schema](db/schema.md)\n" +
      "- [Broken Links](broken.md)\n",
  );

  const edges = [
    { from: "wiki/auth/session.md", to: "wiki/auth/jwt.md",
      type: "extends", provenance: "EXTRACTED",
      evidence: "", source_file: "", date: "2026-04-12" },
    { from: "wiki/auth/session.md", to: "wiki/db/schema.md",
      type: "supports", provenance: "EXTRACTED",
      evidence: "", source_file: "", date: "2026-04-12" },
    { from: "wiki/auth/session.md", to: "wiki/broken.md",
      type: "extends", provenance: "INFERRED",
      evidence: "", source_file: "", date: "2026-04-12" },
    { from: "wiki/auth/jwt.md", to: "wiki/db/schema.md",
      type: "supports", provenance: "EXTRACTED",
      evidence: "", source_file: "", date: "2026-04-12" },
    { from: "wiki/db/schema.md", to: "wiki/broken.md",
      type: "extends", provenance: "AMBIGUOUS",
      evidence: "", source_file: "", date: "2026-04-12" },
  ];
  fs.writeFileSync(
    path.join(wikiRoot, "graph", "edges.jsonl"),
    edges.map((e) => JSON.stringify(e)).join("\n") + "\n",
  );

  return wikiRoot;
}
