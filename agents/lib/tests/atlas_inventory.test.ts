/**
 * Tests for atlas_inventory.ts — pre-Phase-2 manifest builder.
 *
 * Each describe block targets one detection function plus the shared
 * generate / persist / load round-trip.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  detectProjectMetadata,
  detectOrmEntities,
  detectRestEndpoints,
  detectCodeClients,
  discoverShippedRestProfiles,
  generateInventory,
  inventoryPath,
  persistInventory,
  loadInventory,
  loadCustomRestProfiles,
  loadRestProfile,
  resolveRestProfiles,
  type CodeInventory,
  type RestProfile,
} from "../atlas_inventory.js";
import { makeTmpPath, cleanupTmpPath } from "./fixtures.js";

const VALID_RUN_ID = "2026-05-01T10-30-00";

// ── detectProjectMetadata ──────────────────────────────────────────

describe("detectProjectMetadata", () => {
  let tmpPath: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("atlas-inv-meta-");
  });

  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("returns unknown / empty for a repo with no manifest", () => {
    const meta = detectProjectMetadata(tmpPath);
    expect(meta.name).toBe("");
    expect(meta.version).toBe("");
    expect(meta.language).toBe("unknown");
    expect(meta.runtime).toBe("");
    expect(meta.manifests_seen).toEqual([]);
  });

  it("reads name + version from package.json (Node)", () => {
    fs.writeFileSync(
      path.join(tmpPath, "package.json"),
      JSON.stringify({
        name: "my-app",
        version: "1.2.3",
        engines: { node: ">=20.0.0 <21.0.0" },
      }),
    );
    const meta = detectProjectMetadata(tmpPath);
    expect(meta.name).toBe("my-app");
    expect(meta.version).toBe("1.2.3");
    expect(meta.language).toBe("typescript");
    expect(meta.runtime).toBe("node@20");
    expect(meta.manifests_seen).toEqual(["package.json"]);
  });

  it("falls back to plain `node` when engines.node is absent", () => {
    fs.writeFileSync(
      path.join(tmpPath, "package.json"),
      JSON.stringify({ name: "x", version: "0.1.0" }),
    );
    const meta = detectProjectMetadata(tmpPath);
    expect(meta.runtime).toBe("node");
  });

  it("reads PEP 621 [project] from pyproject.toml", () => {
    fs.writeFileSync(
      path.join(tmpPath, "pyproject.toml"),
      `[project]
name = "py-app"
version = "0.5.0"
`,
    );
    const meta = detectProjectMetadata(tmpPath);
    expect(meta.name).toBe("py-app");
    expect(meta.version).toBe("0.5.0");
    expect(meta.language).toBe("python");
    expect(meta.runtime).toBe("python");
    expect(meta.manifests_seen).toEqual(["pyproject.toml"]);
  });

  it("falls back to [tool.poetry] when [project] is absent", () => {
    fs.writeFileSync(
      path.join(tmpPath, "pyproject.toml"),
      `[tool.poetry]
name = "poetry-app"
version = "2.0.0"
`,
    );
    const meta = detectProjectMetadata(tmpPath);
    expect(meta.name).toBe("poetry-app");
    expect(meta.version).toBe("2.0.0");
  });

  it("reads module + go version from go.mod", () => {
    fs.writeFileSync(
      path.join(tmpPath, "go.mod"),
      `module github.com/example/proj

go 1.22

require example/dep v1.0.0
`,
    );
    const meta = detectProjectMetadata(tmpPath);
    expect(meta.name).toBe("github.com/example/proj");
    expect(meta.language).toBe("go");
    expect(meta.runtime).toBe("go@1.22");
    expect(meta.manifests_seen).toEqual(["go.mod"]);
  });

  it("reads [package] from Cargo.toml", () => {
    fs.writeFileSync(
      path.join(tmpPath, "Cargo.toml"),
      `[package]
name = "rust-app"
version = "3.1.4"
rust-version = "1.70"
`,
    );
    const meta = detectProjectMetadata(tmpPath);
    expect(meta.name).toBe("rust-app");
    expect(meta.version).toBe("3.1.4");
    expect(meta.language).toBe("rust");
    expect(meta.runtime).toBe("rust@1.70");
  });

  it("priorities package.json over later manifests when both exist", () => {
    fs.writeFileSync(
      path.join(tmpPath, "package.json"),
      JSON.stringify({ name: "node-app", version: "1.0.0" }),
    );
    fs.writeFileSync(
      path.join(tmpPath, "pyproject.toml"),
      `[project]
name = "py-app"
version = "0.1.0"
`,
    );
    const meta = detectProjectMetadata(tmpPath);
    expect(meta.name).toBe("node-app");
    expect(meta.version).toBe("1.0.0");
    expect(meta.language).toBe("typescript");
    // Both manifests seen and reported.
    expect(meta.manifests_seen).toEqual(["package.json", "pyproject.toml"]);
  });

  it("appends a note when a manifest is unparseable", () => {
    fs.writeFileSync(path.join(tmpPath, "package.json"), "{not json");
    const notes: string[] = [];
    const meta = detectProjectMetadata(tmpPath, notes);
    expect(meta.manifests_seen).toEqual([]);
    expect(notes.some((n) => n.startsWith("package.json unparseable"))).toBe(
      true,
    );
  });
});

// ── detectOrmEntities ──────────────────────────────────────────────

describe("detectOrmEntities", () => {
  let tmpPath: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("atlas-inv-orm-");
  });

  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("returns empty when no ORM markers are present", () => {
    fs.writeFileSync(path.join(tmpPath, "x.ts"), "console.log('hi');\n");
    expect(detectOrmEntities(tmpPath)).toEqual([]);
  });

  it("extracts SQLAlchemy entities from a tmp Python file", () => {
    fs.mkdirSync(path.join(tmpPath, "models"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpPath, "models", "user.py"),
      `from sqlalchemy import Column, Integer, String
from sqlalchemy.orm import declarative_base

Base = declarative_base()

class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True)
    email = Column(String)
`,
    );
    const entities = detectOrmEntities(tmpPath);
    expect(entities.length).toBeGreaterThan(0);
    const user = entities.find((e) => e.class_name === "User");
    expect(user).toBeTruthy();
    expect(user!.profile).toBe("sqlalchemy");
    expect(user!.table_name).toBe("users");
    expect(user!.source_file.endsWith("models/user.py")).toBe(true);
  });
});

// ── detectRestEndpoints ────────────────────────────────────────────

describe("detectRestEndpoints", () => {
  let tmpPath: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("atlas-inv-rest-");
  });

  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("loads the Express profile from disk", () => {
    const profile = loadRestProfile("express");
    expect(profile).not.toBeNull();
    expect(profile?.name).toBe("express");
    expect(profile?.endpoint_extraction.patterns.length).toBeGreaterThan(0);
  });

  it("returns null on a missing profile", () => {
    expect(loadRestProfile("nonexistent")).toBeNull();
  });

  it("extracts Express routes from a tmp file with marker import", () => {
    fs.mkdirSync(path.join(tmpPath, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpPath, "src", "routes.ts"),
      `import express from "express";
const app = express();
app.get('/api/users', (req, res) => res.json([]));
app.post("/api/users", (req, res) => res.status(201).end());
router.put('/api/users/:id', (req, res) => res.end());
const ignored = "app.delete('/x')"; // string literal, but still matches by regex
`,
    );
    const profile = loadRestProfile("express")!;
    const eps = detectRestEndpoints(tmpPath, [profile]);
    const tuples = eps.map((e) => `${e.method} ${e.path}`);
    expect(tuples).toContain("GET /api/users");
    expect(tuples).toContain("POST /api/users");
    expect(tuples).toContain("PUT /api/users/:id");
    // line numbers 1-indexed
    const get = eps.find((e) => e.method === "GET" && e.path === "/api/users");
    expect(get?.line).toBe(3);
  });

  it("skips files without an Express marker import", () => {
    fs.mkdirSync(path.join(tmpPath, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpPath, "src", "routes.ts"),
      `app.get('/api/users', (req, res) => res.json([]));\n`,
    );
    const profile = loadRestProfile("express")!;
    expect(detectRestEndpoints(tmpPath, [profile])).toEqual([]);
  });

  it("returns empty when an empty profile list is passed", () => {
    expect(detectRestEndpoints(tmpPath, [])).toEqual([]);
  });
});

// ── discoverShippedRestProfiles + per-profile fixtures ─────────────

describe("discoverShippedRestProfiles", () => {
  it("returns the four shipped profiles, sorted", () => {
    const names = discoverShippedRestProfiles();
    expect(names).toEqual(["express", "fastapi", "rails", "spring"]);
  });
});

describe("FastAPI profile", () => {
  let tmpPath: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("atlas-inv-fastapi-");
  });

  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("loads cleanly from disk", () => {
    const p = loadRestProfile("fastapi");
    expect(p).not.toBeNull();
    expect(p?.language).toBe("python");
  });

  it("extracts decorator-style FastAPI routes", () => {
    fs.writeFileSync(
      path.join(tmpPath, "main.py"),
      `from fastapi import FastAPI

app = FastAPI()

@app.get("/api/users")
async def list_users():
    return []

@app.post('/api/users')
async def create_user():
    return {}

@router.put(f"/api/users/{user_id}")
async def update_user():
    return {}
`,
    );
    const profile = loadRestProfile("fastapi")!;
    const eps = detectRestEndpoints(tmpPath, [profile]);
    const tuples = eps.map((e) => `${e.method} ${e.path}`);
    expect(tuples).toContain("GET /api/users");
    expect(tuples).toContain("POST /api/users");
    expect(tuples.find((t) => t.startsWith("PUT "))).toBeTruthy();
  });

  it("skips Python files without a fastapi import", () => {
    fs.writeFileSync(
      path.join(tmpPath, "tasks.py"),
      `@app.get("/internal")\ndef handler(): pass\n`,
    );
    const profile = loadRestProfile("fastapi")!;
    expect(detectRestEndpoints(tmpPath, [profile])).toEqual([]);
  });
});

describe("Spring profile", () => {
  let tmpPath: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("atlas-inv-spring-");
  });

  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("loads cleanly from disk", () => {
    const p = loadRestProfile("spring");
    expect(p).not.toBeNull();
    expect(p?.language).toBe("java");
  });

  it("extracts @VerbMapping-style Spring routes", () => {
    fs.mkdirSync(path.join(tmpPath, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpPath, "src", "UserController.java"),
      `import org.springframework.web.bind.annotation.*;

@RestController
public class UserController {
    @GetMapping("/api/users")
    public List<User> list() { return null; }

    @PostMapping(value = "/api/users")
    public User create() { return null; }

    @PutMapping(path = "/api/users/{id}")
    public User update() { return null; }
}
`,
    );
    const profile = loadRestProfile("spring")!;
    const eps = detectRestEndpoints(tmpPath, [profile]);
    const tuples = eps.map((e) => `${e.method} ${e.path}`);
    expect(tuples).toContain("GET /api/users");
    expect(tuples).toContain("POST /api/users");
    expect(tuples).toContain("PUT /api/users/{id}");
  });
});

describe("Rails profile", () => {
  let tmpPath: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("atlas-inv-rails-");
  });

  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("loads cleanly from disk", () => {
    const p = loadRestProfile("rails");
    expect(p).not.toBeNull();
    expect(p?.language).toBe("ruby");
  });

  it("extracts routes from config/routes.rb verb declarations", () => {
    fs.mkdirSync(path.join(tmpPath, "config"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpPath, "config", "routes.rb"),
      `Rails.application.routes.draw do
  get "/api/users", to: "users#index"
  post '/api/users', to: 'users#create'
  put "/api/users/:id", to: "users#update"
  delete '/api/users/:id', to: 'users#destroy'
  resources :posts  # block — intentionally NOT extracted in v1
end
`,
    );
    const profile = loadRestProfile("rails")!;
    const eps = detectRestEndpoints(tmpPath, [profile]);
    const tuples = eps.map((e) => `${e.method} ${e.path}`);
    expect(tuples).toContain("GET /api/users");
    expect(tuples).toContain("POST /api/users");
    expect(tuples).toContain("PUT /api/users/:id");
    expect(tuples).toContain("DELETE /api/users/:id");
  });
});

// ── resolveRestProfiles ─────────────────────────────────────────────

describe("resolveRestProfiles", () => {
  let tmpPath: string;
  let configPath: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("atlas-inv-resolve-");
    configPath = path.join(tmpPath, "wiki.config.yaml");
  });

  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("returns all four shipped profiles when no name list is given", () => {
    const out = resolveRestProfiles({});
    const names = out.map((p) => p.name).sort();
    expect(names).toEqual(["express", "fastapi", "rails", "spring"]);
  });

  it("filters to the named subset when profileNames is given", () => {
    const out = resolveRestProfiles({ profileNames: ["express", "fastapi"] });
    const names = out.map((p) => p.name).sort();
    expect(names).toEqual(["express", "fastapi"]);
  });

  it("silently drops unknown profile names", () => {
    const out = resolveRestProfiles({ profileNames: ["express", "nonexistent"] });
    expect(out.map((p) => p.name)).toEqual(["express"]);
  });

  it("loads custom profiles from wiki.config.yaml (default-set mode)", () => {
    fs.writeFileSync(
      configPath,
      `wiki:
  name: x
ecosystem:
  rest:
    custom_profiles:
      - name: hono
        language: typescript
        detection:
          file_patterns: ["**/*.ts"]
          markers:
            - pattern: 'from "hono"'
        endpoint_extraction:
          patterns:
            - regex: "app\\\\.(get|post)\\\\(['\\"]([^'\\"]+)"
              method_group: 1
              path_group: 2
`,
    );
    const out = resolveRestProfiles({ wikiConfigPath: configPath });
    const names = out.map((p) => p.name);
    expect(names).toContain("hono");
    expect(names).toContain("express"); // shipped
    expect(names).toContain("fastapi"); // shipped
  });

  it("custom profile wins on name collision with shipped", () => {
    fs.writeFileSync(
      configPath,
      `wiki:
  name: x
ecosystem:
  rest:
    custom_profiles:
      - name: express
        language: typescript
        description: "OVERRIDDEN-EXPRESS"
        detection:
          file_patterns: ["**/*.ts"]
          markers:
            - pattern: 'from "express"'
        endpoint_extraction:
          patterns:
            - regex: "app\\\\.(get)\\\\(['\\"]([^'\\"]+)"
              method_group: 1
              path_group: 2
`,
    );
    const out = resolveRestProfiles({ wikiConfigPath: configPath });
    const express = out.find((p) => p.name === "express")!;
    expect(express.description).toBe("OVERRIDDEN-EXPRESS");
  });

  it("returns shipped-only when wiki.config.yaml has no custom_profiles", () => {
    fs.writeFileSync(configPath, `wiki:\n  name: x\n`);
    const out = resolveRestProfiles({ wikiConfigPath: configPath });
    expect(out.map((p) => p.name).sort()).toEqual([
      "express",
      "fastapi",
      "rails",
      "spring",
    ]);
  });

  it("ignores malformed custom_profiles entries silently", () => {
    fs.writeFileSync(
      configPath,
      `ecosystem:
  rest:
    custom_profiles:
      - name: ok
        language: typescript
        detection:
          file_patterns: ["**/*.ts"]
          markers: []
        endpoint_extraction:
          patterns: []
      - this-is-not-a-profile
      - name: 42
        language: invalid
`,
    );
    const out = resolveRestProfiles({ wikiConfigPath: configPath });
    const names = out.map((p) => p.name);
    expect(names).toContain("ok");
    expect(names).not.toContain("42");
  });
});

// ── loadCustomRestProfiles ─────────────────────────────────────────

describe("loadCustomRestProfiles", () => {
  let tmpPath: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("atlas-inv-custom-");
  });

  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("returns [] when the config file is missing", () => {
    expect(loadCustomRestProfiles(path.join(tmpPath, "missing.yaml"))).toEqual([]);
  });

  it("returns [] when the YAML is malformed", () => {
    const p = path.join(tmpPath, "bad.yaml");
    fs.writeFileSync(p, "{not: yaml::: ::");
    expect(loadCustomRestProfiles(p)).toEqual([]);
  });

  it("returns [] when ecosystem.rest is absent", () => {
    const p = path.join(tmpPath, "config.yaml");
    fs.writeFileSync(p, "wiki:\n  name: x\n");
    expect(loadCustomRestProfiles(p)).toEqual([]);
  });
});

// ── Dedup across profiles ──────────────────────────────────────────

describe("dedup across profiles", () => {
  let tmpPath: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("atlas-inv-dedup-");
  });

  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("does not double-count an endpoint matched by two profiles", () => {
    // Custom profile that overlaps with Express on `app.get('/x', ...)`.
    const customProfile: RestProfile = {
      name: "custom-overlap",
      language: "typescript",
      detection: {
        file_patterns: ["**/*.ts"],
        markers: [{ pattern: 'from "express"', type: "import" }],
      },
      endpoint_extraction: {
        patterns: [
          {
            regex: "app\\.(get|post)\\(['\"]([^'\"]+)['\"]",
            method_group: 1,
            path_group: 2,
          },
        ],
      },
    };
    fs.writeFileSync(
      path.join(tmpPath, "routes.ts"),
      `import express from "express";\nconst app = express();\napp.get('/x', () => {});\n`,
    );
    const expressProfile = loadRestProfile("express")!;
    const eps = detectRestEndpoints(tmpPath, [expressProfile, customProfile]);
    const xRoutes = eps.filter((e) => e.path === "/x" && e.method === "GET");
    expect(xRoutes).toHaveLength(1);
    // First profile (express) wins on the framework field.
    expect(xRoutes[0]!.framework).toBe("express");
  });
});

// ── detectCodeClients ──────────────────────────────────────────────

describe("detectCodeClients", () => {
  let tmpPath: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("atlas-inv-clients-");
  });

  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("finds gather() callsites", () => {
    fs.writeFileSync(
      path.join(tmpPath, "main.ts"),
      `import { gather } from "narai-primitives";
const x = await gather({ prompt: "hi", consumer: "doc-wiki" });
`,
    );
    const clients = detectCodeClients(tmpPath);
    expect(clients.length).toBeGreaterThan(0);
    expect(clients.some((c) => c.kind === "gather" && c.line === 2)).toBe(true);
  });

  it("finds fetchWithCaps() callsites", () => {
    fs.writeFileSync(
      path.join(tmpPath, "main.ts"),
      `import { fetchWithCaps } from "narai-primitives/toolkit";
const r = await fetchWithCaps("https://example.com");
`,
    );
    const clients = detectCodeClients(tmpPath);
    expect(clients.some((c) => c.kind === "fetchWithCaps")).toBe(true);
  });

  it("does not match string-literal occurrences without parens", () => {
    fs.writeFileSync(
      path.join(tmpPath, "main.ts"),
      `// gather is documented elsewhere\nconsole.log("gather");\n`,
    );
    expect(detectCodeClients(tmpPath)).toEqual([]);
  });

  it("returns empty when no source files match", () => {
    fs.writeFileSync(path.join(tmpPath, "README.md"), "no code here");
    expect(detectCodeClients(tmpPath)).toEqual([]);
  });
});

// ── generateInventory + persist + load round-trip ──────────────────

describe("inventory round-trip", () => {
  let tmpPath: string;
  let wikiRoot: string;
  let repoRoot: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("atlas-inv-roundtrip-");
    wikiRoot = path.join(tmpPath, "wiki-root");
    repoRoot = path.join(tmpPath, "repo-root");
    fs.mkdirSync(wikiRoot, { recursive: true });
    fs.mkdirSync(repoRoot, { recursive: true });
    fs.writeFileSync(
      path.join(repoRoot, "package.json"),
      JSON.stringify({ name: "demo", version: "0.1.0" }),
    );
  });

  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("generates a manifest with the canonical shape", () => {
    const inv = generateInventory(repoRoot, VALID_RUN_ID);
    expect(inv.atlas_run_id).toBe(VALID_RUN_ID);
    expect(inv.repo_root).toBe(path.resolve(repoRoot));
    expect(inv.project_metadata.name).toBe("demo");
    expect(inv.project_metadata.version).toBe("0.1.0");
    expect(Array.isArray(inv.orm_entities)).toBe(true);
    expect(Array.isArray(inv.rest_endpoints)).toBe(true);
    expect(Array.isArray(inv.code_clients)).toBe(true);
    expect(typeof inv.stats.duration_ms).toBe("number");
    expect(inv.generated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("respects enableOrm / enableRest flags", () => {
    fs.writeFileSync(
      path.join(repoRoot, "routes.ts"),
      `import express from "express";\nconst app = express();\napp.get('/x', () => {});\n`,
    );
    const offRest = generateInventory(repoRoot, VALID_RUN_ID, {
      enableRest: false,
    });
    expect(offRest.rest_endpoints).toEqual([]);
    const onRest = generateInventory(repoRoot, VALID_RUN_ID, {
      enableRest: true,
    });
    expect(onRest.rest_endpoints.length).toBeGreaterThan(0);
  });

  it("persists to canonical path and round-trips via loadInventory", () => {
    const inv = generateInventory(repoRoot, VALID_RUN_ID);
    const target = persistInventory(wikiRoot, inv);
    expect(target).toBe(inventoryPath(wikiRoot, VALID_RUN_ID));
    expect(fs.existsSync(target)).toBe(true);
    const loaded = loadInventory(wikiRoot, VALID_RUN_ID);
    expect(loaded).toEqual(inv);
  });

  it("loadInventory returns null for a missing run-id", () => {
    expect(loadInventory(wikiRoot, "2099-01-01T00-00-00")).toBeNull();
  });

  it("loadInventory returns null on shape mismatch (mid-file run-id swap)", () => {
    const inv = generateInventory(repoRoot, VALID_RUN_ID);
    persistInventory(wikiRoot, inv);
    const target = inventoryPath(wikiRoot, VALID_RUN_ID);
    const raw = JSON.parse(fs.readFileSync(target, "utf-8")) as Record<string, unknown>;
    raw["atlas_run_id"] = "2099-01-01T00-00-00";
    fs.writeFileSync(target, JSON.stringify(raw));
    expect(loadInventory(wikiRoot, VALID_RUN_ID)).toBeNull();
  });

  it("loadInventory returns null on malformed JSON", () => {
    const target = inventoryPath(wikiRoot, VALID_RUN_ID);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, "{not json");
    expect(loadInventory(wikiRoot, VALID_RUN_ID)).toBeNull();
  });
});
