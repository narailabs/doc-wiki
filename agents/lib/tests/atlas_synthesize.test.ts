/**
 * Tests for atlas_synthesize.ts — read-only input bundles for the
 * /doc-wiki:atlas Phase 7 global synthesis. Each `assembleX` function
 * produces a `SynthesisBundle` ({sources, text, notes}) that the LLM
 * synthesis step consumes.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "js-yaml";

import {
  assembleCommandsInputs,
  assembleConfigurationInputs,
  assembleDeployInputs,
  assembleGettingStartedInputs,
  assembleIntegrationsInputs,
  assembleOverviewInputs,
  assembleTroubleshootingInputs,
  extractTopicFromPath,
  groupManifestByTopicFacet,
} from "../atlas_synthesize.js";
import { type CodeInventory } from "../atlas_inventory.js";
import { makeTmpPath, cleanupTmpPath } from "./fixtures.js";

// ── Helpers ─────────────────────────────────────────────────────────

function writeAtlasPage(
  wikiRoot: string,
  relPath: string,
  facet: string,
  body: string = "body",
  extraFrontmatter: Record<string, unknown> = {},
): void {
  const full = path.join(wikiRoot, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(
    full,
    "---\n" +
      yaml.dump({
        title: facet,
        atlas_facet: facet,
        atlas_run_id: "r1",
        ...extraFrontmatter,
      }) +
      "---\n\n" +
      body +
      "\n",
  );
}

function makeWikiRoot(tmpPath: string): string {
  fs.mkdirSync(path.join(tmpPath, "wiki"), { recursive: true });
  fs.mkdirSync(path.join(tmpPath, "log"), { recursive: true });
  return tmpPath;
}

// ── assembleOverviewInputs ─────────────────────────────────────────

describe("assembleOverviewInputs", () => {
  let tmpPath: string;
  let wikiRoot: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("atlas-syn-overview-");
    wikiRoot = makeWikiRoot(tmpPath);
  });

  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("returns a sparse bundle with a note when no architecture pages exist", () => {
    const bundle = assembleOverviewInputs(wikiRoot);
    expect(bundle.sources).toEqual([]);
    expect(bundle.notes).toContain("no architecture.md pages found — overview will be sparse");
  });

  it("emits an audience-routing table at the top when atlas pages exist", () => {
    writeAtlasPage(wikiRoot, "wiki/auth/architecture.md", "architecture", "auth body");
    writeAtlasPage(wikiRoot, "wiki/billing/data-model.md", "data-model", "billing body");
    const bundle = assembleOverviewInputs(wikiRoot);
    expect(bundle.text).toContain("## Audience routing");
    expect(bundle.text).toContain("| Audience | Pages |");
    // architecture + data-model both default to contributor — same row.
    const lines = bundle.text.split("\n");
    const contribRow = lines.find((l) => l.startsWith("| contributor |"));
    expect(contribRow).toBeTruthy();
    expect(contribRow).toContain("wiki/auth/architecture.md");
    expect(contribRow).toContain("wiki/billing/data-model.md");
  });

  it("orders the audience-routing rows new-user → operator → contributor → integrator → debugger", () => {
    writeAtlasPage(wikiRoot, "wiki/auth/architecture.md", "architecture");
    writeAtlasPage(wikiRoot, "wiki/auth/api.md", "api");
    writeAtlasPage(wikiRoot, "wiki/auth/operations.md", "operations");
    writeAtlasPage(wikiRoot, "wiki/auth/troubleshooting.md", "troubleshooting");
    writeAtlasPage(wikiRoot, "wiki/auth/getting-started.md", "getting-started");
    const bundle = assembleOverviewInputs(wikiRoot);
    const lines = bundle.text.split("\n");
    const rowIndex = (audience: string): number =>
      lines.findIndex((l) => l.startsWith(`| ${audience} |`));
    const order = [
      rowIndex("new-user"),
      rowIndex("operator"),
      rowIndex("contributor"),
      rowIndex("integrator"),
      rowIndex("debugger"),
    ];
    // Every audience produced a row.
    for (const i of order) expect(i).toBeGreaterThan(0);
    // Each later audience appears after the previous one.
    for (let i = 1; i < order.length; i++) {
      expect(order[i]).toBeGreaterThan(order[i - 1]!);
    }
  });

  it("honors an explicit `audience` frontmatter override", () => {
    writeAtlasPage(
      wikiRoot,
      "wiki/auth/architecture.md",
      "architecture",
      "body",
      { audience: "operator" },
    );
    const bundle = assembleOverviewInputs(wikiRoot);
    const lines = bundle.text.split("\n");
    const opRow = lines.find((l) => l.startsWith("| operator |"));
    expect(opRow).toContain("wiki/auth/architecture.md");
    // No contributor row at all — the only page got remapped.
    expect(lines.find((l) => l.startsWith("| contributor |"))).toBeFalsy();
  });

  it("includes architecture page bodies in full and per-facet TL;DRs", () => {
    writeAtlasPage(
      wikiRoot,
      "wiki/auth/architecture.md",
      "architecture",
      "FULL ARCHITECTURE BODY",
    );
    writeAtlasPage(
      wikiRoot,
      "wiki/auth/data-model.md",
      "data-model",
      "## TL;DR\nthe data-model summary\n\n## Body\nirrelevant",
    );
    const bundle = assembleOverviewInputs(wikiRoot);
    expect(bundle.text).toContain("FULL ARCHITECTURE BODY");
    expect(bundle.text).toContain("the data-model summary");
    expect(bundle.text).toContain("## Per-facet TL;DRs");
  });
});

// ── assembleIntegrationsInputs ─────────────────────────────────────

describe("assembleIntegrationsInputs", () => {
  let tmpPath: string;
  let wikiRoot: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("atlas-syn-integ-");
    wikiRoot = makeWikiRoot(tmpPath);
  });

  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("flags architecture-page lines that mention a builtin connector id", () => {
    // jira / github / etc. are sourced from BUILTIN_PATTERNS via source_registry.
    writeAtlasPage(
      wikiRoot,
      "wiki/auth/architecture.md",
      "architecture",
      "We sync issues to JIRA via the connector.\nGITHUB notifications go to Slack.",
    );
    const bundle = assembleIntegrationsInputs(wikiRoot);
    expect(bundle.text).toContain("external-mentions in wiki/auth/architecture.md");
    expect(bundle.text.toLowerCase()).toContain("jira");
    expect(bundle.text.toLowerCase()).toContain("github");
  });

  it("still flags mentions of common SaaS keywords not in BUILTIN_PATTERNS", () => {
    writeAtlasPage(
      wikiRoot,
      "wiki/billing/architecture.md",
      "architecture",
      "Payments use Stripe and observability is Datadog.",
    );
    const bundle = assembleIntegrationsInputs(wikiRoot);
    expect(bundle.text.toLowerCase()).toContain("stripe");
    expect(bundle.text.toLowerCase()).toContain("datadog");
  });

  it("does NOT flag the `db` keyword (filtered out as not an external service)", () => {
    writeAtlasPage(
      wikiRoot,
      "wiki/auth/architecture.md",
      "architecture",
      "We talk to the local postgres DB at startup.",
    );
    const bundle = assembleIntegrationsInputs(wikiRoot);
    // "db" should not produce an external-mention row.
    expect(bundle.text).not.toContain("external-mentions");
  });

  it("does NOT flag the bare word `linear` (too common a word for free-text scan)", () => {
    writeAtlasPage(
      wikiRoot,
      "wiki/perf/architecture.md",
      "architecture",
      "Retries use linear backoff and the scan is linear in input size.",
    );
    const bundle = assembleIntegrationsInputs(wikiRoot);
    // The bare word "linear" must not produce a false-positive
    // external-mention row; only the unambiguous "linear.app" token does.
    expect(bundle.text).not.toContain("external-mentions");
  });

  it("DOES flag a genuine linear.app URL mention", () => {
    writeAtlasPage(
      wikiRoot,
      "wiki/eng/architecture.md",
      "architecture",
      "Issues are tracked at https://linear.app/acme/issue/ENG-1.",
    );
    const bundle = assembleIntegrationsInputs(wikiRoot);
    expect(bundle.text).toContain("external-mentions in wiki/eng/architecture.md");
    expect(bundle.text.toLowerCase()).toContain("linear.app");
  });

  it("DOES flag a linear:// scheme mention", () => {
    writeAtlasPage(
      wikiRoot,
      "wiki/eng/architecture.md",
      "architecture",
      "Tickets are referenced as linear://acme/ENG-1 in code comments.",
    );
    const bundle = assembleIntegrationsInputs(wikiRoot);
    expect(bundle.text).toContain("external-mentions in wiki/eng/architecture.md");
  });

  it("notes when no api pages exist", () => {
    const bundle = assembleIntegrationsInputs(wikiRoot);
    expect(bundle.notes.some((n) => n.includes("no api.md pages found"))).toBe(true);
  });
});

// ── assembleDeployInputs (smoke test for new behavior alongside existing) ──

describe("assembleDeployInputs", () => {
  let tmpPath: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("atlas-syn-deploy-");
  });

  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("notes when no deploy files match", () => {
    const bundle = assembleDeployInputs(tmpPath);
    expect(bundle.sources).toEqual([]);
    expect(bundle.notes.some((n) => n.includes("no build/deploy files matched"))).toBe(true);
  });

  it("picks up a top-level Dockerfile", () => {
    fs.writeFileSync(path.join(tmpPath, "Dockerfile"), "FROM node:20\nRUN ls\n");
    const bundle = assembleDeployInputs(tmpPath);
    expect(bundle.sources).toContain("Dockerfile");
    expect(bundle.text).toContain("FROM node:20");
  });
});

// ── assembleCommandsInputs ────────────────────────────────────────

describe("assembleCommandsInputs", () => {
  let tmpPath: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("atlas-syn-cmds-");
  });

  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("notes when no commands/ directory exists", () => {
    const bundle = assembleCommandsInputs(tmpPath);
    expect(bundle.sources).toEqual([]);
    expect(bundle.notes.some((n) => n.includes("no commands/ directory"))).toBe(true);
  });

  it("includes every commands/*.md wrapper", () => {
    fs.mkdirSync(path.join(tmpPath, "commands"), { recursive: true });
    fs.writeFileSync(path.join(tmpPath, "commands", "init.md"), "## init\n\nbootstrap\n");
    fs.writeFileSync(path.join(tmpPath, "commands", "ingest.md"), "## ingest\n\nfetch\n");
    const bundle = assembleCommandsInputs(tmpPath);
    expect(bundle.sources).toContain("commands/init.md");
    expect(bundle.sources).toContain("commands/ingest.md");
    expect(bundle.text).toContain("bootstrap");
    expect(bundle.text).toContain("fetch");
  });

  it("prepends a Mermaid `flowchart TD` seed of the slash-command fan-out", () => {
    fs.mkdirSync(path.join(tmpPath, "commands"), { recursive: true });
    fs.writeFileSync(path.join(tmpPath, "commands", "init.md"), "init body");
    fs.writeFileSync(path.join(tmpPath, "commands", "ingest.md"), "ingest body");
    const bundle = assembleCommandsInputs(tmpPath);
    expect(bundle.text).toContain("<!-- mermaid-seed: slash-command fan-out");
    expect(bundle.text).toContain("```mermaid");
    expect(bundle.text).toContain("flowchart TD");
    expect(bundle.text).toContain('cmd_init["/init"]');
    expect(bundle.text).toContain('cmd_ingest["/ingest"]');
    expect(bundle.text).toContain("user --> cmd_init");
    expect(bundle.text).toContain("cmd_init --> orch");
    // classDef styling must be present so audience-conditional rendering
    // can pick up the actor / cmd / orch buckets.
    expect(bundle.text).toContain("classDef actor");
    expect(bundle.text).toContain("classDef cmd");
    expect(bundle.text).toContain("classDef orch");
    // The seed appears before the per-command bodies (parts.unshift).
    const seedIdx = bundle.text.indexOf("mermaid-seed");
    const firstCmdIdx = bundle.text.indexOf("## commands/init.md");
    expect(seedIdx).toBeGreaterThanOrEqual(0);
    expect(firstCmdIdx).toBeGreaterThan(seedIdx);
  });

  it("does not emit a Mermaid seed when no commands/ directory exists", () => {
    const bundle = assembleCommandsInputs(tmpPath);
    expect(bundle.text).not.toContain("mermaid-seed");
    expect(bundle.text).not.toContain("flowchart TD");
  });

  it("extracts `### /` slash-command headings from any SKILL.md under skills/", () => {
    const skillDir = path.join(tmpPath, "skills", "my-skill");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, "SKILL.md"),
      [
        "# My Skill",
        "",
        "## Commands",
        "",
        "### /my-skill:foo",
        "",
        "Do foo.",
        "",
        "### /my-skill:bar",
        "",
        "Do bar.",
        "",
        "### Not a slash command",
        "",
      ].join("\n"),
    );
    const bundle = assembleCommandsInputs(tmpPath);
    expect(bundle.text).toContain("### /my-skill:foo");
    expect(bundle.text).toContain("### /my-skill:bar");
    expect(bundle.text).not.toContain("### Not a slash command");
    expect(bundle.sources.some((s) => s.endsWith("SKILL.md"))).toBe(true);
  });
});

// ── assembleGettingStartedInputs ──────────────────────────────────

describe("assembleGettingStartedInputs", () => {
  let tmpPath: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("atlas-syn-gs-");
  });

  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("notes when no README and no bootstrap files exist", () => {
    const bundle = assembleGettingStartedInputs(tmpPath);
    expect(bundle.sources).toEqual([]);
    expect(bundle.notes.some((n) => n.includes("no README.md"))).toBe(true);
  });

  it("includes README + package.json scripts + Makefile", () => {
    fs.writeFileSync(path.join(tmpPath, "README.md"), "# Project\n\nQuick start\n");
    fs.writeFileSync(
      path.join(tmpPath, "package.json"),
      JSON.stringify({ scripts: { test: "vitest", build: "tsc" } }),
    );
    fs.writeFileSync(path.join(tmpPath, "Makefile"), "build:\n\tnpm run build\n");
    const bundle = assembleGettingStartedInputs(tmpPath);
    expect(bundle.sources).toContain("README.md");
    expect(bundle.sources).toContain("package.json");
    expect(bundle.sources).toContain("Makefile");
    expect(bundle.text).toContain("Quick start");
    expect(bundle.text).toContain('"vitest"');
    expect(bundle.text).toContain("npm run build");
  });

  it("truncates very large README bodies", () => {
    const big = "A".repeat(100 * 1024);
    fs.writeFileSync(path.join(tmpPath, "README.md"), big);
    const bundle = assembleGettingStartedInputs(tmpPath);
    expect(bundle.text).toContain("... [truncated]");
  });

  it("skips package.json scripts section when empty/missing", () => {
    fs.writeFileSync(path.join(tmpPath, "README.md"), "x");
    fs.writeFileSync(path.join(tmpPath, "package.json"), JSON.stringify({ name: "x" }));
    const bundle = assembleGettingStartedInputs(tmpPath);
    expect(bundle.text).not.toContain("package.json scripts");
  });
});

// ── assembleConfigurationInputs ───────────────────────────────────

describe("assembleConfigurationInputs", () => {
  let tmpPath: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("atlas-syn-config-");
  });

  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("notes when no configuration files match", () => {
    const bundle = assembleConfigurationInputs(tmpPath);
    expect(bundle.sources).toEqual([]);
    expect(bundle.notes.some((n) => n.includes("no configuration files matched"))).toBe(true);
  });

  it("picks up top-level config files matching the globs", () => {
    fs.writeFileSync(path.join(tmpPath, "wiki.config.yaml"), "domain: test\n");
    fs.writeFileSync(path.join(tmpPath, ".env.example"), "DB_URL=\n");
    fs.writeFileSync(path.join(tmpPath, "pyproject.toml"), "[tool.poetry]\nname=\"x\"\n");
    const bundle = assembleConfigurationInputs(tmpPath);
    expect(bundle.sources).toContain("wiki.config.yaml");
    expect(bundle.sources).toContain(".env.example");
    expect(bundle.sources).toContain("pyproject.toml");
    expect(bundle.text).toContain("domain: test");
  });

  it("walks the config/ and .connectors/ directories", () => {
    fs.mkdirSync(path.join(tmpPath, "config"), { recursive: true });
    fs.writeFileSync(path.join(tmpPath, "config", "app.yaml"), "app: yes\n");
    fs.mkdirSync(path.join(tmpPath, ".connectors"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpPath, ".connectors", "config.yaml"),
      "consumers:\n  doc-wiki: {}\n",
    );
    const bundle = assembleConfigurationInputs(tmpPath);
    expect(bundle.sources).toContain("config/app.yaml");
    expect(bundle.sources).toContain(".connectors/config.yaml");
  });

  it("does NOT include unrelated top-level files", () => {
    fs.writeFileSync(path.join(tmpPath, "README.md"), "x");
    fs.writeFileSync(path.join(tmpPath, "package.json"), "{}");
    const bundle = assembleConfigurationInputs(tmpPath);
    expect(bundle.sources).not.toContain("README.md");
    expect(bundle.sources).not.toContain("package.json");
  });
});

// ── assembleTroubleshootingInputs ─────────────────────────────────

describe("assembleTroubleshootingInputs", () => {
  let tmpPath: string;
  let wikiRoot: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("atlas-syn-tshoot-");
    wikiRoot = makeWikiRoot(tmpPath);
  });

  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("notes when events.jsonl does not exist", () => {
    const bundle = assembleTroubleshootingInputs(wikiRoot);
    expect(bundle.notes.some((n) => n.includes("no log/events.jsonl found"))).toBe(true);
  });

  it("surfaces error events from events.jsonl", () => {
    const eventsPath = path.join(wikiRoot, "log", "events.jsonl");
    fs.writeFileSync(
      eventsPath,
      [
        JSON.stringify({ op: "ingest", status: "ok" }),
        JSON.stringify({ op: "ingest", status: "failed", error: "timeout" }),
        JSON.stringify({ op: "atlas", details: { error: "permission denied" } }),
      ].join("\n") + "\n",
    );
    const bundle = assembleTroubleshootingInputs(wikiRoot);
    expect(bundle.sources).toContain("log/events.jsonl");
    expect(bundle.text).toContain("Recent error/failure events");
    expect(bundle.text).toContain("timeout");
    expect(bundle.text).toContain("permission denied");
    // The non-error ingest event must not appear.
    expect(bundle.text).not.toContain('"op":"ingest","status":"ok"');
  });

  // The backward buffer scan replaced `.split("\n")`; blank rows and a
  // missing final terminator were previously normalized away by `split`.
  it("surfaces error events across blank rows and a missing terminator", () => {
    const eventsPath = path.join(wikiRoot, "log", "events.jsonl");
    fs.writeFileSync(
      eventsPath,
      "\n\n" +
        JSON.stringify({ op: "ingest", status: "failed", error: "timeout" }) +
        "\n\n\n" +
        JSON.stringify({ op: "atlas", details: { error: "permission denied" } }),
    );
    const bundle = assembleTroubleshootingInputs(wikiRoot);
    expect(bundle.text).toContain("timeout");
    expect(bundle.text).toContain("permission denied");
  });

  it("notes when no error events exist", () => {
    const eventsPath = path.join(wikiRoot, "log", "events.jsonl");
    fs.writeFileSync(eventsPath, JSON.stringify({ op: "ingest", status: "ok" }) + "\n");
    const bundle = assembleTroubleshootingInputs(wikiRoot);
    expect(bundle.notes.some((n) => n.includes("no error events in events.jsonl"))).toBe(true);
  });

  it("includes the latest atlas drift report when present", () => {
    const runDir = path.join(wikiRoot, "outputs", "atlas", "2026-04-30T10-00-00");
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, "drift-report.md"), "# Drift\n\nstale auth/architecture.md\n");
    const bundle = assembleTroubleshootingInputs(wikiRoot);
    expect(bundle.sources.some((s) => s.includes("drift-report.md"))).toBe(true);
    expect(bundle.text).toContain("stale auth/architecture.md");
  });

  it("picks the most recent drift report when multiple runs exist", () => {
    const older = path.join(wikiRoot, "outputs", "atlas", "2026-04-29T10-00-00");
    const newer = path.join(wikiRoot, "outputs", "atlas", "2026-04-30T10-00-00");
    fs.mkdirSync(older, { recursive: true });
    fs.mkdirSync(newer, { recursive: true });
    fs.writeFileSync(path.join(older, "drift-report.md"), "OLD DRIFT");
    fs.writeFileSync(path.join(newer, "drift-report.md"), "NEW DRIFT");
    const bundle = assembleTroubleshootingInputs(wikiRoot);
    expect(bundle.text).toContain("NEW DRIFT");
    expect(bundle.text).not.toContain("OLD DRIFT");
  });
});

// ── Manifest-driven source lookups ─────────────────────────────────

function emptyInventory(overrides: Partial<CodeInventory> = {}): CodeInventory {
  return {
    atlas_run_id: "2026-05-03T00-00-00",
    generated_at: "2026-05-03T00:00:00.000Z",
    repo_root: "/repo",
    project_metadata: {
      name: "x",
      version: "0.0.0",
      language: "unknown",
      runtime: "",
      manifests_seen: [],
    },
    orm_entities: [],
    rest_endpoints: [],
    code_clients: [],
    stats: { files_walked: 0, files_skipped_for_size: 0, duration_ms: 0 },
    notes: [],
    ...overrides,
  };
}

describe("extractTopicFromPath", () => {
  it("extracts topic from src/<topic>/...", () => {
    expect(extractTopicFromPath("src/auth/models/user.py")).toBe("auth");
    expect(extractTopicFromPath("src/billing/routes/payments.ts")).toBe("billing");
  });

  it("works for app, services, lib, internal, pkg, packages, modules, cmd, apps", () => {
    expect(extractTopicFromPath("app/users/controllers/index.rb")).toBe("users");
    expect(extractTopicFromPath("services/auth/handler.go")).toBe("auth");
    expect(extractTopicFromPath("lib/billing/calc.ts")).toBe("billing");
    expect(extractTopicFromPath("internal/users/store.go")).toBe("users");
    expect(extractTopicFromPath("pkg/auth/jwt.go")).toBe("auth");
    expect(extractTopicFromPath("packages/billing/index.ts")).toBe("billing");
    expect(extractTopicFromPath("modules/users/service.php")).toBe("users");
    expect(extractTopicFromPath("cmd/server/main.go")).toBe("server");
    expect(extractTopicFromPath("apps/dashboard/layout.tsx")).toBe("dashboard");
  });

  it("strips -service / -svc / -module suffixes (matches Phase 2 canonicalization)", () => {
    expect(extractTopicFromPath("src/auth-service/api.ts")).toBe("auth");
    expect(extractTopicFromPath("services/billing-svc/index.go")).toBe("billing");
    expect(extractTopicFromPath("lib/users-module/handler.ts")).toBe("users");
  });

  it("returns null when no recognized prefix is present", () => {
    expect(extractTopicFromPath("agents/lib/foo.ts")).toBeNull();
    expect(extractTopicFromPath("docs/intro.md")).toBeNull();
    expect(extractTopicFromPath("Makefile")).toBeNull();
  });

  it("returns null when the topic candidate is the leaf (looks like a file)", () => {
    // src/utils.ts → no topic; the "candidate" is the file itself.
    expect(extractTopicFromPath("src/utils.ts")).toBeNull();
    expect(extractTopicFromPath("lib/index.js")).toBeNull();
  });

  it("tolerates leading slashes and multiple separators", () => {
    expect(extractTopicFromPath("/src/auth/foo.py")).toBe("auth");
    expect(extractTopicFromPath("src//billing//x.ts")).toBe("billing");
  });
});

describe("groupManifestByTopicFacet", () => {
  it("groups orm_entities into data-model and rest_endpoints into api", () => {
    const inv = emptyInventory({
      orm_entities: [
        {
          profile: "sqlalchemy",
          class_name: "User",
          table_name: "users",
          schema_name: "",
          source_file: "src/auth/models/user.py",
          columns: [],
          relationships: [],
        },
        {
          profile: "sqlalchemy",
          class_name: "Invoice",
          table_name: "invoices",
          schema_name: "",
          source_file: "src/billing/models/invoice.py",
          columns: [],
          relationships: [],
        },
      ],
      rest_endpoints: [
        {
          framework: "fastapi",
          method: "GET",
          path: "/api/users",
          file: "src/auth/routes/users.py",
          line: 10,
        },
        {
          framework: "fastapi",
          method: "POST",
          path: "/api/payments",
          file: "src/billing/routes/payments.py",
          line: 22,
        },
      ],
    });
    const grouped = groupManifestByTopicFacet(inv, ["auth", "billing"]);
    expect(grouped["auth"]).toEqual({
      "data-model": ["src/auth/models/user.py"],
      api: ["src/auth/routes/users.py"],
    });
    expect(grouped["billing"]).toEqual({
      "data-model": ["src/billing/models/invoice.py"],
      api: ["src/billing/routes/payments.py"],
    });
  });

  it("drops entries whose extracted topic is not in the wanted list", () => {
    const inv = emptyInventory({
      orm_entities: [
        {
          profile: "sqlalchemy",
          class_name: "User",
          table_name: "users",
          schema_name: "",
          source_file: "src/auth/models/user.py",
          columns: [],
          relationships: [],
        },
        {
          profile: "sqlalchemy",
          class_name: "Telemetry",
          table_name: "telemetry",
          schema_name: "",
          source_file: "src/observability/models/event.py",
          columns: [],
          relationships: [],
        },
      ],
    });
    const grouped = groupManifestByTopicFacet(inv, ["auth"]);
    expect(Object.keys(grouped)).toEqual(["auth"]);
    expect(grouped["auth"]?.["data-model"]).toEqual(["src/auth/models/user.py"]);
  });

  it("canonicalizes the wanted-topics list (auth-service ≡ auth)", () => {
    const inv = emptyInventory({
      orm_entities: [
        {
          profile: "django",
          class_name: "User",
          table_name: "users",
          schema_name: "",
          source_file: "src/auth/models.py",
          columns: [],
          relationships: [],
        },
      ],
    });
    const grouped = groupManifestByTopicFacet(inv, ["Auth-Service"]);
    expect(grouped["auth"]?.["data-model"]).toEqual(["src/auth/models.py"]);
  });

  it("dedupes when multiple endpoints in the same file map to the same topic", () => {
    const inv = emptyInventory({
      rest_endpoints: [
        { framework: "fastapi", method: "GET",  path: "/a", file: "src/auth/routes.py", line: 1 },
        { framework: "fastapi", method: "POST", path: "/a", file: "src/auth/routes.py", line: 2 },
      ],
    });
    const grouped = groupManifestByTopicFacet(inv, ["auth"]);
    expect(grouped["auth"]?.["api"]).toEqual(["src/auth/routes.py"]);
  });

  it("returns empty object when no manifest entry matches a wanted topic", () => {
    const inv = emptyInventory({
      orm_entities: [
        {
          profile: "django",
          class_name: "User",
          table_name: "users",
          schema_name: "",
          source_file: "src/auth/models.py",
          columns: [],
          relationships: [],
        },
      ],
    });
    expect(groupManifestByTopicFacet(inv, ["billing"])).toEqual({});
  });
});

// ── Archive exclusion ──────────────────────────────────────────────

describe("atlas_synthesize archive exclusion", () => {
  let tmpPath: string;
  let wikiRoot: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("atlas-syn-archive-");
    wikiRoot = makeWikiRoot(tmpPath);
  });

  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("overview bundle omits archived topic pages", () => {
    writeAtlasPage(wikiRoot, "wiki/auth/architecture.md", "architecture", "live arch body");
    writeAtlasPage(wikiRoot, "wiki/_archive/billing/architecture.md", "architecture", "archived arch body");
    const bundle = assembleOverviewInputs(wikiRoot);
    expect(bundle.sources).toContain("wiki/auth/architecture.md");
    expect(bundle.sources.some((s) => s.includes("_archive"))).toBe(false);
    expect(bundle.text).not.toContain("archived arch body");
  });

  it("integrations bundle omits archived api pages", () => {
    writeAtlasPage(wikiRoot, "wiki/auth/api.md", "api", "live api body");
    writeAtlasPage(wikiRoot, "wiki/_archive/billing/api.md", "api", "archived api body");
    const bundle = assembleIntegrationsInputs(wikiRoot);
    expect(bundle.sources.some((s) => s.includes("_archive"))).toBe(false);
    expect(bundle.text).not.toContain("archived api body");
  });
});
