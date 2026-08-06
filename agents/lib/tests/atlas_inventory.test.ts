/**
 * Tests for atlas_inventory.ts — pre-Phase-2 manifest builder.
 *
 * Each describe block targets one detection function plus the shared
 * generate / persist / load round-trip.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
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
  main,
  _readEcosystemRestEnabled,
  _readEcosystemCrossServiceEnabled,
  _countLinesTo,
  resolveCrossService,
  type CodeInventory,
  type RestProfile,
} from "../atlas_inventory.js";
import { makeTmpPath, cleanupTmpPath } from "./fixtures.js";
import { buildServiceGraph } from "../cross_service_edges.js";

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

  it("detects Java/Maven project metadata from pom.xml (parent-skipped)", () => {
    const root = makeTmpPath("java-meta");
    fs.writeFileSync(path.join(root, "pom.xml"), `<project>
    <parent><artifactId>spring-boot-starter-parent</artifactId><version>2.7.11</version></parent>
    <artifactId>intake</artifactId><version>1.4.0</version>
    <properties><java.version>17</java.version></properties>
  </project>`);
    const meta = detectProjectMetadata(root);
    expect(meta.name).toBe("intake");
    expect(meta.version).toBe("1.4.0");
    expect(meta.language).toBe("java");
    expect(meta.runtime).toBe("java@17");
    expect(meta.manifests_seen).toContain("pom.xml");
    cleanupTmpPath(root);
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
  it("returns all eighteen shipped profiles, sorted", () => {
    const names = discoverShippedRestProfiles();
    expect(names).toEqual([
      "actix",
      "aspnet",
      "django",
      "echo",
      "express",
      "fastapi",
      "fastify",
      "flask",
      "gin",
      "hono",
      "koa",
      "laravel",
      "phoenix",
      "rails",
      "rocket",
      "slim",
      "spring",
      "vapor",
    ]);
  });
});

describe("Django profile", () => {
  let tmpPath: string;
  beforeEach(() => { tmpPath = makeTmpPath("atlas-inv-django-"); });
  afterEach(() => { cleanupTmpPath(tmpPath); });

  it("loads cleanly from disk", () => {
    const p = loadRestProfile("django");
    expect(p).not.toBeNull();
    expect(p?.language).toBe("python");
  });

  it("extracts URLconf entries (path / re_path)", () => {
    fs.writeFileSync(
      path.join(tmpPath, "urls.py"),
      `from django.urls import path, re_path
from . import views

urlpatterns = [
    path("api/users/", views.UserList.as_view(), name="user-list"),
    path("api/users/<int:pk>/", views.UserDetail.as_view()),
    re_path(r"^api/legacy/$", views.legacy_handler),
]
`,
    );
    const profile = loadRestProfile("django")!;
    const eps = detectRestEndpoints(tmpPath, [profile]);
    const urls = eps.map((e) => e.path).sort();
    expect(urls).toContain("api/users/");
    expect(urls).toContain("api/users/<int:pk>/");
    expect(urls).toContain("^api/legacy/$");
  });

  it("skips Python files without a django.urls import", () => {
    fs.writeFileSync(
      path.join(tmpPath, "tasks.py"),
      `path("/internal/", lambda: None)\n`,
    );
    const profile = loadRestProfile("django")!;
    expect(detectRestEndpoints(tmpPath, [profile])).toEqual([]);
  });
});

describe("Flask profile", () => {
  let tmpPath: string;
  beforeEach(() => { tmpPath = makeTmpPath("atlas-inv-flask-"); });
  afterEach(() => { cleanupTmpPath(tmpPath); });

  it("loads cleanly from disk", () => {
    const p = loadRestProfile("flask");
    expect(p).not.toBeNull();
    expect(p?.language).toBe("python");
  });

  it("extracts @app.route(methods=), @app.<verb> shorthand, and bare @app.route default-GET", () => {
    fs.writeFileSync(
      path.join(tmpPath, "app.py"),
      `from flask import Flask
app = Flask(__name__)

@app.route("/api/users", methods=["GET"])
def list_users(): pass

@app.route('/api/users', methods=['POST'])
def create_user(): pass

@app.get("/api/users/<int:user_id>")
def show(user_id): pass

@app.delete('/api/users/<int:user_id>')
def remove(user_id): pass

@app.route("/api/health")
def health(): pass

@app.route('/api/version')
def version(): pass
`,
    );
    const profile = loadRestProfile("flask")!;
    const eps = detectRestEndpoints(tmpPath, [profile]);
    const tuples = eps.map((e) => `${e.method} ${e.path}`);
    expect(tuples).toContain("GET /api/users");
    expect(tuples).toContain("POST /api/users");
    expect(tuples).toContain("GET /api/users/<int:user_id>");
    expect(tuples).toContain("DELETE /api/users/<int:user_id>");
    expect(tuples).toContain("GET /api/health");
    expect(tuples).toContain("GET /api/version");
  });

  it("does not double-count the explicit-methods= form via the bare-route pattern", () => {
    fs.writeFileSync(
      path.join(tmpPath, "app.py"),
      `from flask import Flask
app = Flask(__name__)

@app.route("/api/users", methods=["POST"])
def create_user(): pass
`,
    );
    const profile = loadRestProfile("flask")!;
    const eps = detectRestEndpoints(tmpPath, [profile]);
    expect(eps).toHaveLength(1);
    expect(eps[0]?.method).toBe("POST");
    expect(eps[0]?.path).toBe("/api/users");
  });
});

describe("ASP.NET profile", () => {
  let tmpPath: string;
  beforeEach(() => { tmpPath = makeTmpPath("atlas-inv-aspnet-"); });
  afterEach(() => { cleanupTmpPath(tmpPath); });

  it("loads cleanly from disk", () => {
    const p = loadRestProfile("aspnet");
    expect(p).not.toBeNull();
    expect(p?.language).toBe("csharp");
  });

  it("extracts [HttpVerb] attribute routes (absolute paths)", () => {
    fs.mkdirSync(path.join(tmpPath, "Controllers"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpPath, "Controllers", "UsersController.cs"),
      `using Microsoft.AspNetCore.Mvc;

[ApiController]
[Route("api/[controller]")]
public class UsersController : ControllerBase
{
    [HttpGet("/api/users")]
    public IActionResult List() => Ok();

    [HttpPost("/api/users")]
    public IActionResult Create() => Created("/", null);

    [HttpDelete("/api/users/{id:int}")]
    public IActionResult Delete(int id) => NoContent();
}
`,
    );
    const profile = loadRestProfile("aspnet")!;
    const eps = detectRestEndpoints(tmpPath, [profile]);
    const tuples = eps.map((e) => `${e.method} ${e.path}`);
    expect(tuples).toContain("GET /api/users");
    expect(tuples).toContain("POST /api/users");
    expect(tuples).toContain("DELETE /api/users/{id:int}");
  });

  it("prepends class-level [Route(...)] prefix to relative paths", () => {
    fs.mkdirSync(path.join(tmpPath, "Controllers"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpPath, "Controllers", "OrdersController.cs"),
      `using Microsoft.AspNetCore.Mvc;

[ApiController]
[Route("api/orders")]
public class OrdersController : ControllerBase
{
    [HttpGet]
    public IActionResult List() => Ok();

    [HttpGet("{id:int}")]
    public IActionResult Get(int id) => Ok();

    [HttpPost]
    public IActionResult Create() => Created("/", null);

    [HttpDelete("{id:int}")]
    public IActionResult Delete(int id) => NoContent();
}
`,
    );
    const profile = loadRestProfile("aspnet")!;
    const eps = detectRestEndpoints(tmpPath, [profile]);
    const tuples = eps.map((e) => `${e.method} ${e.path}`);
    expect(tuples).toContain("GET api/orders");
    expect(tuples).toContain("GET api/orders/{id:int}");
    expect(tuples).toContain("POST api/orders");
    expect(tuples).toContain("DELETE api/orders/{id:int}");
  });

  it("expands the [controller] token in the class-level [Route]", () => {
    fs.mkdirSync(path.join(tmpPath, "Controllers"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpPath, "Controllers", "AuthController.cs"),
      `using Microsoft.AspNetCore.Mvc;

[ApiController]
[Route("api/[controller]")]
public class AuthController : ControllerBase
{
    [HttpPost("login")]
    public IActionResult Login() => Ok();

    [HttpPost("logout")]
    public IActionResult Logout() => Ok();
}
`,
    );
    const profile = loadRestProfile("aspnet")!;
    const eps = detectRestEndpoints(tmpPath, [profile]);
    const tuples = eps.map((e) => `${e.method} ${e.path}`);
    expect(tuples).toContain("POST api/auth/login");
    expect(tuples).toContain("POST api/auth/logout");
  });

  it("absolute paths in [HttpVerb] bypass the class-level prefix", () => {
    fs.mkdirSync(path.join(tmpPath, "Controllers"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpPath, "Controllers", "MixedController.cs"),
      `using Microsoft.AspNetCore.Mvc;

[ApiController]
[Route("api/mixed")]
public class MixedController : ControllerBase
{
    [HttpGet]
    public IActionResult List() => Ok();

    [HttpGet("/healthz")]
    public IActionResult Health() => Ok();
}
`,
    );
    const profile = loadRestProfile("aspnet")!;
    const eps = detectRestEndpoints(tmpPath, [profile]);
    const tuples = eps.map((e) => `${e.method} ${e.path}`);
    expect(tuples).toContain("GET api/mixed");
    expect(tuples).toContain("GET /healthz");
  });

  it("falls back to relative path when the class has no [Route]", () => {
    fs.mkdirSync(path.join(tmpPath, "Controllers"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpPath, "Controllers", "StatusController.cs"),
      `using Microsoft.AspNetCore.Mvc;

[ApiController]
public class StatusController : ControllerBase
{
    [HttpGet("/healthz")]
    public IActionResult Health() => Ok();
}
`,
    );
    const profile = loadRestProfile("aspnet")!;
    const eps = detectRestEndpoints(tmpPath, [profile]);
    const tuples = eps.map((e) => `${e.method} ${e.path}`);
    expect(tuples).toEqual(["GET /healthz"]);
  });
});

describe("Gin profile", () => {
  let tmpPath: string;
  beforeEach(() => { tmpPath = makeTmpPath("atlas-inv-gin-"); });
  afterEach(() => { cleanupTmpPath(tmpPath); });

  it("loads cleanly from disk", () => {
    const p = loadRestProfile("gin");
    expect(p).not.toBeNull();
    expect(p?.language).toBe("go");
  });

  it("extracts r.GET / r.POST etc. routes", () => {
    fs.writeFileSync(
      path.join(tmpPath, "main.go"),
      `package main

import "github.com/gin-gonic/gin"

func main() {
    r := gin.Default()
    r.GET("/api/users", listUsers)
    r.POST("/api/users", createUser)
    r.PUT("/api/users/:id", updateUser)
    api := r.Group("/v2")
    api.DELETE("/api/users/:id", deleteUser)
    r.Run()
}
`,
    );
    const profile = loadRestProfile("gin")!;
    const eps = detectRestEndpoints(tmpPath, [profile]);
    const tuples = eps.map((e) => `${e.method} ${e.path}`);
    expect(tuples).toContain("GET /api/users");
    expect(tuples).toContain("POST /api/users");
    expect(tuples).toContain("PUT /api/users/:id");
    expect(tuples).toContain("DELETE /api/users/:id");
  });
});

describe("Laravel profile", () => {
  let tmpPath: string;
  beforeEach(() => { tmpPath = makeTmpPath("atlas-inv-laravel-"); });
  afterEach(() => { cleanupTmpPath(tmpPath); });

  it("loads cleanly from disk", () => {
    const p = loadRestProfile("laravel");
    expect(p).not.toBeNull();
    expect(p?.language).toBe("php");
  });

  it("extracts Route::verb declarations", () => {
    fs.mkdirSync(path.join(tmpPath, "routes"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpPath, "routes", "api.php"),
      `<?php
use Illuminate\\Support\\Facades\\Route;

Route::get('/api/users', [UserController::class, 'index']);
Route::post("/api/users", [UserController::class, 'store']);
Route::put('/api/users/{user}', [UserController::class, 'update']);
Route::delete("/api/users/{user}", [UserController::class, 'destroy']);
`,
    );
    const profile = loadRestProfile("laravel")!;
    const eps = detectRestEndpoints(tmpPath, [profile]);
    const tuples = eps.map((e) => `${e.method} ${e.path}`);
    expect(tuples).toContain("GET /api/users");
    expect(tuples).toContain("POST /api/users");
    expect(tuples).toContain("PUT /api/users/{user}");
    expect(tuples).toContain("DELETE /api/users/{user}");
  });
});

describe("Hono profile", () => {
  let tmpPath: string;
  beforeEach(() => { tmpPath = makeTmpPath("atlas-inv-hono-"); });
  afterEach(() => { cleanupTmpPath(tmpPath); });

  it("loads cleanly from disk", () => {
    const p = loadRestProfile("hono");
    expect(p).not.toBeNull();
    expect(p?.language).toBe("typescript");
  });

  it("extracts Hono routes from a file with the hono import", () => {
    fs.writeFileSync(
      path.join(tmpPath, "app.ts"),
      `import { Hono } from "hono";

const app = new Hono();

app.get('/api/users', (c) => c.json([]));
app.post("/api/users", (c) => c.json({}, 201));
app.delete(\`/api/users/:id\`, (c) => c.text(""));
`,
    );
    const profile = loadRestProfile("hono")!;
    const eps = detectRestEndpoints(tmpPath, [profile]);
    const tuples = eps.map((e) => `${e.method} ${e.path}`);
    expect(tuples).toContain("GET /api/users");
    expect(tuples).toContain("POST /api/users");
    expect(tuples).toContain("DELETE /api/users/:id");
  });

  it("does NOT match files that import express, not hono", () => {
    fs.writeFileSync(
      path.join(tmpPath, "app.ts"),
      `import express from "express";
const app = express();
app.get('/x', () => {});
`,
    );
    const profile = loadRestProfile("hono")!;
    expect(detectRestEndpoints(tmpPath, [profile])).toEqual([]);
  });

  it("does NOT extract .use() middleware as a route", () => {
    fs.writeFileSync(
      path.join(tmpPath, "app.ts"),
      `import { Hono } from "hono";
import { logger } from "hono/logger";

const app = new Hono();

app.use('/api/*', logger());
app.use('*', async (c, next) => { await next(); });
app.get('/api/users', (c) => c.json([]));
app.post('/api/users', (c) => c.json({}, 201));
`,
    );
    const profile = loadRestProfile("hono")!;
    const eps = detectRestEndpoints(tmpPath, [profile]);
    const tuples = eps.map((e) => `${e.method} ${e.path}`);
    expect(tuples).toEqual(["GET /api/users", "POST /api/users"]);
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

describe("Fastify profile", () => {
  let tmpPath: string;
  beforeEach(() => { tmpPath = makeTmpPath("atlas-inv-fastify-"); });
  afterEach(() => { cleanupTmpPath(tmpPath); });

  it("loads cleanly from disk", () => {
    const p = loadRestProfile("fastify");
    expect(p).not.toBeNull();
    expect(p?.language).toBe("typescript");
  });

  it("extracts fastify.* / app.* / server.* verb routes", () => {
    fs.writeFileSync(
      path.join(tmpPath, "server.ts"),
      `import Fastify from 'fastify';
const fastify = Fastify();
fastify.get('/api/users', async () => []);
fastify.post("/api/users", async () => ({}));
app.put(\`/api/users/:id\`, async () => ({}));
server.delete('/api/users/:id', async () => undefined);
`,
    );
    const profile = loadRestProfile("fastify")!;
    const eps = detectRestEndpoints(tmpPath, [profile]);
    const tuples = eps.map((e) => `${e.method} ${e.path}`);
    expect(tuples).toContain("GET /api/users");
    expect(tuples).toContain("POST /api/users");
    expect(tuples).toContain("PUT /api/users/:id");
    expect(tuples).toContain("DELETE /api/users/:id");
    const get = eps.find((e) => e.method === "GET")!;
    expect(get.line).toBe(3);
  });

  it("skips files without a fastify import", () => {
    fs.writeFileSync(
      path.join(tmpPath, "x.ts"),
      `app.get('/api/users', async () => []);\n`,
    );
    const profile = loadRestProfile("fastify")!;
    expect(detectRestEndpoints(tmpPath, [profile])).toEqual([]);
  });
});

describe("Koa profile", () => {
  let tmpPath: string;
  beforeEach(() => { tmpPath = makeTmpPath("atlas-inv-koa-"); });
  afterEach(() => { cleanupTmpPath(tmpPath); });

  it("loads cleanly from disk", () => {
    const p = loadRestProfile("koa");
    expect(p).not.toBeNull();
    expect(p?.language).toBe("typescript");
  });

  it("extracts router.* / api.* / app.* verb routes", () => {
    fs.writeFileSync(
      path.join(tmpPath, "routes.ts"),
      `import Router from "@koa/router";
const router = new Router();
router.get('/api/users', (ctx) => {});
router.post("/api/users", (ctx) => {});
api.put(\`/api/users/:id\`, (ctx) => {});
app.delete('/api/users/:id', (ctx) => {});
`,
    );
    const profile = loadRestProfile("koa")!;
    const eps = detectRestEndpoints(tmpPath, [profile]);
    const tuples = eps.map((e) => `${e.method} ${e.path}`);
    expect(tuples).toContain("GET /api/users");
    expect(tuples).toContain("POST /api/users");
    expect(tuples).toContain("PUT /api/users/:id");
    expect(tuples).toContain("DELETE /api/users/:id");
    const get = eps.find((e) => e.method === "GET")!;
    expect(get.line).toBe(3);
  });

  it("skips files without a koa-router import", () => {
    fs.writeFileSync(
      path.join(tmpPath, "x.ts"),
      `router.get('/api/users', (ctx) => {});\n`,
    );
    const profile = loadRestProfile("koa")!;
    expect(detectRestEndpoints(tmpPath, [profile])).toEqual([]);
  });
});

describe("Echo profile", () => {
  let tmpPath: string;
  beforeEach(() => { tmpPath = makeTmpPath("atlas-inv-echo-"); });
  afterEach(() => { cleanupTmpPath(tmpPath); });

  it("loads cleanly from disk", () => {
    const p = loadRestProfile("echo");
    expect(p).not.toBeNull();
    expect(p?.language).toBe("go");
  });

  it("extracts e.* / g.* SHOUTING-CASE verb routes", () => {
    fs.writeFileSync(
      path.join(tmpPath, "main.go"),
      `package main

import "github.com/labstack/echo/v4"

func main() {
    e := echo.New()
    e.GET("/api/users", listUsers)
    e.POST("/api/users", createUser)
    g := e.Group("/v2")
    g.PUT("/api/users/:id", updateUser)
    api.DELETE("/api/users/:id", deleteUser)
    e.Start(":8080")
}
`,
    );
    const profile = loadRestProfile("echo")!;
    const eps = detectRestEndpoints(tmpPath, [profile]);
    const tuples = eps.map((e) => `${e.method} ${e.path}`);
    expect(tuples).toContain("GET /api/users");
    expect(tuples).toContain("POST /api/users");
    expect(tuples).toContain("PUT /api/users/:id");
    expect(tuples).toContain("DELETE /api/users/:id");
  });
});

describe("Rocket profile", () => {
  let tmpPath: string;
  beforeEach(() => { tmpPath = makeTmpPath("atlas-inv-rocket-"); });
  afterEach(() => { cleanupTmpPath(tmpPath); });

  it("loads cleanly from disk", () => {
    const p = loadRestProfile("rocket");
    expect(p).not.toBeNull();
    expect(p?.language).toBe("rust");
  });

  it("extracts #[verb(\"/path\")] attribute-macro routes", () => {
    fs.writeFileSync(
      path.join(tmpPath, "main.rs"),
      `#[macro_use] extern crate rocket;
use rocket::*;

#[get("/api/users")]
fn list() -> &'static str { "" }

#[post("/api/users")]
fn create() {}

#[put("/api/users/<id>")]
fn update() {}

#[delete("/api/users/<id>")]
fn destroy() {}
`,
    );
    const profile = loadRestProfile("rocket")!;
    const eps = detectRestEndpoints(tmpPath, [profile]);
    const tuples = eps.map((e) => `${e.method} ${e.path}`);
    expect(tuples).toContain("GET /api/users");
    expect(tuples).toContain("POST /api/users");
    expect(tuples).toContain("PUT /api/users/<id>");
    expect(tuples).toContain("DELETE /api/users/<id>");
    const get = eps.find((e) => e.method === "GET")!;
    expect(get.line).toBe(4);
  });
});

describe("Actix profile", () => {
  let tmpPath: string;
  beforeEach(() => { tmpPath = makeTmpPath("atlas-inv-actix-"); });
  afterEach(() => { cleanupTmpPath(tmpPath); });

  it("loads cleanly from disk", () => {
    const p = loadRestProfile("actix");
    expect(p).not.toBeNull();
    expect(p?.language).toBe("rust");
  });

  it("extracts .route(\"/path\", web::verb()) registration routes", () => {
    fs.writeFileSync(
      path.join(tmpPath, "main.rs"),
      `use actix_web::{web, App, HttpServer};

fn main() {
    let app = App::new()
        .route("/api/users", web::get().to(list_users))
        .route("/api/users", web::post().to(create_user))
        .route("/api/users/{id}", web::put().to(update_user))
        .route("/api/users/{id}", web::delete().to(delete_user));
}
`,
    );
    const profile = loadRestProfile("actix")!;
    const eps = detectRestEndpoints(tmpPath, [profile]);
    const tuples = eps.map((e) => `${e.method} ${e.path}`);
    expect(tuples).toContain("GET /api/users");
    expect(tuples).toContain("POST /api/users");
    expect(tuples).toContain("PUT /api/users/{id}");
    expect(tuples).toContain("DELETE /api/users/{id}");
  });

  it("skips Rust files without an actix_web import", () => {
    fs.writeFileSync(
      path.join(tmpPath, "x.rs"),
      `app.route("/x", web::get().to(h));\n`,
    );
    const profile = loadRestProfile("actix")!;
    expect(detectRestEndpoints(tmpPath, [profile])).toEqual([]);
  });
});

describe("Slim profile", () => {
  let tmpPath: string;
  beforeEach(() => { tmpPath = makeTmpPath("atlas-inv-slim-"); });
  afterEach(() => { cleanupTmpPath(tmpPath); });

  it("loads cleanly from disk", () => {
    const p = loadRestProfile("slim");
    expect(p).not.toBeNull();
    expect(p?.language).toBe("php");
  });

  it("extracts $app->verb('/path') routes", () => {
    fs.writeFileSync(
      path.join(tmpPath, "index.php"),
      `<?php
use Slim\\App;
use Slim\\Factory\\AppFactory;

$app = AppFactory::create();
$app->get('/api/users', function ($req, $res) {});
$app->post("/api/users", function ($req, $res) {});
$app->put('/api/users/{id}', function ($req, $res) {});
$app->delete("/api/users/{id}", function ($req, $res) {});
`,
    );
    const profile = loadRestProfile("slim")!;
    const eps = detectRestEndpoints(tmpPath, [profile]);
    const tuples = eps.map((e) => `${e.method} ${e.path}`);
    expect(tuples).toContain("GET /api/users");
    expect(tuples).toContain("POST /api/users");
    expect(tuples).toContain("PUT /api/users/{id}");
    expect(tuples).toContain("DELETE /api/users/{id}");
    const get = eps.find((e) => e.method === "GET")!;
    expect(get.line).toBe(6);
  });
});

describe("Phoenix profile", () => {
  let tmpPath: string;
  beforeEach(() => { tmpPath = makeTmpPath("atlas-inv-phoenix-"); });
  afterEach(() => { cleanupTmpPath(tmpPath); });

  it("loads cleanly from disk", () => {
    const p = loadRestProfile("phoenix");
    expect(p).not.toBeNull();
    expect(p?.language).toBe("elixir");
  });

  it("extracts router-block verb declarations", () => {
    fs.writeFileSync(
      path.join(tmpPath, "router.ex"),
      `defmodule MyAppWeb.Router do
  use Phoenix.Router

  scope "/api", MyAppWeb do
    get "/users", UserController, :index
    post "/users", UserController, :create
    put "/users/:id", UserController, :update
    delete "/users/:id", UserController, :delete
  end
end
`,
    );
    const profile = loadRestProfile("phoenix")!;
    const eps = detectRestEndpoints(tmpPath, [profile]);
    const tuples = eps.map((e) => `${e.method} ${e.path}`);
    expect(tuples).toContain("GET /users");
    expect(tuples).toContain("POST /users");
    expect(tuples).toContain("PUT /users/:id");
    expect(tuples).toContain("DELETE /users/:id");
  });

  it("skips Elixir files without a Phoenix.Router marker", () => {
    fs.writeFileSync(
      path.join(tmpPath, "x.ex"),
      `get "/internal", Handler, :run\n`,
    );
    const profile = loadRestProfile("phoenix")!;
    expect(detectRestEndpoints(tmpPath, [profile])).toEqual([]);
  });
});

describe("Vapor profile", () => {
  let tmpPath: string;
  beforeEach(() => { tmpPath = makeTmpPath("atlas-inv-vapor-"); });
  afterEach(() => { cleanupTmpPath(tmpPath); });

  it("loads cleanly from disk", () => {
    const p = loadRestProfile("vapor");
    expect(p).not.toBeNull();
    expect(p?.language).toBe("swift");
  });

  it("extracts app.* / routes.* / grouped.* verb routes", () => {
    fs.writeFileSync(
      path.join(tmpPath, "routes.swift"),
      `import Vapor

func routes(_ app: Application) throws {
    app.get("users") { req in [] }
    app.post("users") { req in "" }
    routes.put("users/:id") { req in "" }
    let grouped = app.grouped("v2")
    grouped.delete("users/:id") { req in "" }
}
`,
    );
    const profile = loadRestProfile("vapor")!;
    const eps = detectRestEndpoints(tmpPath, [profile]);
    const tuples = eps.map((e) => `${e.method} ${e.path}`);
    expect(tuples).toContain("GET users");
    expect(tuples).toContain("POST users");
    expect(tuples).toContain("PUT users/:id");
    expect(tuples).toContain("DELETE users/:id");
  });

  it("skips Swift files without a Vapor marker", () => {
    fs.writeFileSync(
      path.join(tmpPath, "x.swift"),
      `app.get("internal") { req in [] }\n`,
    );
    const profile = loadRestProfile("vapor")!;
    expect(detectRestEndpoints(tmpPath, [profile])).toEqual([]);
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

  it("returns all eighteen shipped profiles when no name list is given", () => {
    const out = resolveRestProfiles({});
    const names = out.map((p) => p.name).sort();
    expect(names).toEqual([
      "actix",
      "aspnet",
      "django",
      "echo",
      "express",
      "fastapi",
      "fastify",
      "flask",
      "gin",
      "hono",
      "koa",
      "laravel",
      "phoenix",
      "rails",
      "rocket",
      "slim",
      "spring",
      "vapor",
    ]);
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
      "actix",
      "aspnet",
      "django",
      "echo",
      "express",
      "fastapi",
      "fastify",
      "flask",
      "gin",
      "hono",
      "koa",
      "laravel",
      "phoenix",
      "rails",
      "rocket",
      "slim",
      "spring",
      "vapor",
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

describe("_readEcosystemRestEnabled", () => {
  let tmpPath: string;
  beforeEach(() => { tmpPath = makeTmpPath("atlas-inv-eco-rest-"); });
  afterEach(() => { cleanupTmpPath(tmpPath); });

  it("returns true when wiki.config.yaml has ecosystem.rest.enabled: true", () => {
    fs.writeFileSync(
      path.join(tmpPath, "wiki.config.yaml"),
      "ecosystem:\n  rest:\n    enabled: true\n",
    );
    expect(_readEcosystemRestEnabled(tmpPath)).toBe(true);
  });

  it("returns false when wiki.config.yaml has ecosystem.rest.enabled: false", () => {
    fs.writeFileSync(
      path.join(tmpPath, "wiki.config.yaml"),
      "ecosystem:\n  rest:\n    enabled: false\n",
    );
    expect(_readEcosystemRestEnabled(tmpPath)).toBe(false);
  });

  it("returns false when wiki.config.yaml is missing", () => {
    expect(_readEcosystemRestEnabled(tmpPath)).toBe(false);
  });

  it("returns false when wiki.config.yaml is malformed", () => {
    fs.writeFileSync(
      path.join(tmpPath, "wiki.config.yaml"),
      "ecosystem: : :\n  not yaml [",
    );
    expect(_readEcosystemRestEnabled(tmpPath)).toBe(false);
  });

  it("returns false when wiki.config.yaml omits the ecosystem.rest key", () => {
    fs.writeFileSync(
      path.join(tmpPath, "wiki.config.yaml"),
      "ecosystem:\n  orm:\n    cross_validate_against_db: true\n",
    );
    expect(_readEcosystemRestEnabled(tmpPath)).toBe(false);
  });

  it("falls back to wiki/wiki.config.yaml when the root copy is missing", () => {
    fs.mkdirSync(path.join(tmpPath, "wiki"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpPath, "wiki", "wiki.config.yaml"),
      "ecosystem:\n  rest:\n    enabled: true\n",
    );
    expect(_readEcosystemRestEnabled(tmpPath)).toBe(true);
  });
});

// ── multi-service inventory (A5) ──────────────────────────────────

describe("generateInventory cross-service", () => {
  it("emits a per-service inventory with owner-tagged rest endpoints", () => {
    const root = makeTmpPath("multi-svc");
    // service A (java) with a controller
    fs.mkdirSync(path.join(root, "svc-a", "src"), { recursive: true });
    fs.writeFileSync(path.join(root, "svc-a", "pom.xml"), "<project><artifactId>svc-a</artifactId></project>");
    fs.writeFileSync(path.join(root, "svc-a", "src", "C.java"),
      '@RestController class C { @GetMapping("/a/ping") String p(){return "";} }');
    // service B (node)
    fs.mkdirSync(path.join(root, "svc-b"), { recursive: true });
    fs.writeFileSync(path.join(root, "svc-b", "package.json"), '{"name":"svc-b"}');

    const inv = generateInventory(root, "2026-06-07T10-00-00", { enableRest: true, enableCrossService: true });
    const ids = inv.services.map((s) => s.identity.id).sort();
    expect(ids).toEqual(["svc-a", "svc-b"]);
    const a = inv.services.find((s) => s.identity.id === "svc-a")!;
    expect(a.rest_endpoints.some((e) => e.path === "/a/ping")).toBe(true);
    // back-compat: single-project still works (no services discovered)
    const single = makeTmpPath("single");
    fs.writeFileSync(path.join(single, "package.json"), '{"name":"x"}');
    const inv2 = generateInventory(single, "2026-06-07T10-00-01", {});
    expect(Array.isArray(inv2.services)).toBe(true);   // present, may be []
    cleanupTmpPath(root); cleanupTmpPath(single);
  });

  it("populates http_clients and queue_endpoints per service with correct owner-tagging (B6)", () => {
    const root = makeTmpPath("multi-svc-b6");

    // service A (java): a Feign client + a RabbitMQ listener
    fs.mkdirSync(path.join(root, "svc-a", "src"), { recursive: true });
    fs.writeFileSync(path.join(root, "svc-a", "pom.xml"),
      "<project><artifactId>svc-a</artifactId></project>");
    fs.writeFileSync(
      path.join(root, "svc-a", "src", "BillingClient.java"),
      `import org.springframework.cloud.openfeign.FeignClient;\n@FeignClient(name = "payments-service", path = "/billing")\ninterface BillingClient {\n  @GetMapping("/invoices")\n  List<Invoice> list();\n}`,
    );
    fs.writeFileSync(
      path.join(root, "svc-a", "src", "EventConsumer.java"),
      `import org.springframework.amqp.rabbit.annotation.RabbitListener;\n@RabbitListener(queues = "events")\nvoid handle(String msg) {}`,
    );

    // service B (node): a BullMQ queue (no Feign, no AMQP)
    fs.mkdirSync(path.join(root, "svc-b"), { recursive: true });
    fs.writeFileSync(path.join(root, "svc-b", "package.json"), '{"name":"svc-b"}');
    fs.writeFileSync(
      path.join(root, "svc-b", "worker.ts"),
      `import { Worker } from 'bullmq';\nconst w = new Worker('invoice-jobs', async job => {});`,
    );

    const inv = generateInventory(root, "2026-06-07T10-00-02", {
      enableRest: true,
      enableCrossService: true,
    });

    const a = inv.services.find((s) => s.identity.id === "svc-a")!;
    const b = inv.services.find((s) => s.identity.id === "svc-b")!;
    expect(a).toBeDefined();
    expect(b).toBeDefined();

    // svc-a owns the Feign client
    expect(a.http_clients.length).toBeGreaterThan(0);
    expect(a.http_clients.every((e) => e.file.startsWith("svc-a/"))).toBe(true);

    // svc-a owns the RabbitMQ consumer
    expect(a.queue_endpoints.length).toBeGreaterThan(0);
    expect(a.queue_endpoints.find((e) => e.queue_name === "events" && e.role === "consumer")).toBeTruthy();
    expect(a.queue_endpoints.every((e) => e.file.startsWith("svc-a/"))).toBe(true);

    // svc-b owns the BullMQ consumer
    expect(b.queue_endpoints.length).toBeGreaterThan(0);
    expect(b.queue_endpoints.find((e) => e.queue_name === "invoice-jobs" && e.role === "consumer")).toBeTruthy();
    expect(b.queue_endpoints.every((e) => e.file.startsWith("svc-b/"))).toBe(true);

    // svc-b has no Feign clients
    expect(b.http_clients.filter((e) => e.framework === "feign")).toHaveLength(0);

    // the scope-out note is present
    expect(inv.notes.some((n) => n.includes("cross-service queue detection"))).toBe(true);

    cleanupTmpPath(root);
  });

  it("resolves a Feign ${prop.url} target through application.yml → host → service (BUG 2)", () => {
    const root = makeTmpPath("multi-svc-feign-prop");

    // svc-a: a Feign client whose url is a property reference; the property is
    // defined in svc-a's application.yml and points at the settings-service
    // host (note the abbreviation: property key says "config", host says
    // "configuration"). Aliases alone cannot bridge this — only property→url→host.
    fs.mkdirSync(path.join(root, "svc-a", "src"), { recursive: true });
    fs.mkdirSync(path.join(root, "svc-a", "src", "main", "resources"), { recursive: true });
    fs.writeFileSync(path.join(root, "svc-a", "pom.xml"),
      "<project><artifactId>svc-a</artifactId></project>");
    fs.writeFileSync(
      path.join(root, "svc-a", "src", "ConfigClient.java"),
      `import org.springframework.cloud.openfeign.FeignClient;\n@FeignClient(name = "x", url = "\${config-service.url}")\ninterface ConfigClient {\n  @GetMapping("/api/configuration/clients")\n  List<Cfg> list();\n}`,
    );
    fs.writeFileSync(
      path.join(root, "svc-a", "src", "main", "resources", "application.yml"),
      "config-service:\n  url: http://settings-svc/api/configuration\n",
    );

    // settings-service: exposes the matching endpoint. Its A2-derived
    // aliases include "configuration", so the host settings-svc
    // (strip app-/-service → configuration) resolves here.
    fs.mkdirSync(path.join(root, "settings-service", "src"), { recursive: true });
    fs.writeFileSync(path.join(root, "settings-service", "pom.xml"),
      "<project><artifactId>settings-service</artifactId></project>");
    fs.writeFileSync(
      path.join(root, "settings-service", "src", "Ctrl.java"),
      '@RestController class Ctrl { @GetMapping("/api/configuration/clients") String l(){return "";} }',
    );

    const inv = generateInventory(root, "2026-06-07T10-00-03", {
      enableRest: true,
      enableCrossService: true,
    });

    const a = inv.services.find((s) => s.identity.id === "svc-a")!;
    expect(a).toBeDefined();
    // The Feign client's ${prop} target_ref was resolved against svc-a's yml.
    const client = a.http_clients.find((c) => c.target_ref.startsWith("${"));
    expect(client).toBeDefined();
    expect(client!.resolved_target).toBe("http://settings-svc/api/configuration");

    const g = buildServiceGraph(inv);
    const calls = g.edges.find(
      (e) => e.kind === "calls" && e.from_service === "svc-a" && e.to_service === "settings-service",
    );
    expect(calls).toBeTruthy();
  });
});

describe("main() honors ecosystem.rest.enabled", () => {
  let tmpPath: string;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmpPath = makeTmpPath("atlas-inv-main-eco-");
    // The CLI writes the manifest to stdout; suppress it during tests.
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });
  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    cleanupTmpPath(tmpPath);
  });

  function writeFlaskFile(): void {
    fs.writeFileSync(
      path.join(tmpPath, "app.py"),
      `from flask import Flask
app = Flask(__name__)

@app.route("/api/health")
def health(): pass
`,
    );
  }

  function readManifest(runId: string): CodeInventory {
    const manifest = loadInventory(tmpPath, runId);
    if (!manifest) throw new Error("manifest not found");
    return manifest;
  }

  it("enables REST detection when wiki.config.yaml has ecosystem.rest.enabled: true (no CLI flag)", () => {
    writeFlaskFile();
    fs.writeFileSync(
      path.join(tmpPath, "wiki.config.yaml"),
      "ecosystem:\n  rest:\n    enabled: true\n",
    );
    const runId = "2026-05-03T00-00-00";
    const exit = main([
      "generate",
      "--wiki-root", tmpPath,
      "--repo-root", tmpPath,
      "--run-id", runId,
    ]);
    expect(exit).toBe(0);
    const manifest = readManifest(runId);
    expect(manifest.rest_endpoints.length).toBeGreaterThan(0);
    expect(manifest.rest_endpoints[0]?.method).toBe("GET");
    expect(manifest.rest_endpoints[0]?.path).toBe("/api/health");
  });

  it("leaves REST detection off when wiki.config.yaml is absent and no --enable-rest", () => {
    writeFlaskFile();
    const runId = "2026-05-03T00-00-01";
    const exit = main([
      "generate",
      "--wiki-root", tmpPath,
      "--repo-root", tmpPath,
      "--run-id", runId,
    ]);
    expect(exit).toBe(0);
    expect(readManifest(runId).rest_endpoints).toEqual([]);
  });

  it("--enable-rest forces detection even when config disables it", () => {
    writeFlaskFile();
    fs.writeFileSync(
      path.join(tmpPath, "wiki.config.yaml"),
      "ecosystem:\n  rest:\n    enabled: false\n",
    );
    const runId = "2026-05-03T00-00-02";
    const exit = main([
      "generate",
      "--wiki-root", tmpPath,
      "--repo-root", tmpPath,
      "--run-id", runId,
      "--enable-rest",
    ]);
    expect(exit).toBe(0);
    expect(readManifest(runId).rest_endpoints.length).toBeGreaterThan(0);
  });
});

// ── resolveCrossService: the single shared precedence resolver ────────────

describe("resolveCrossService precedence matrix", () => {
  // Shorthand: build opts with sensible defaults so each case states only the
  // dimensions it exercises.
  const r = (o: Partial<Parameters<typeof resolveCrossService>[0]>): boolean =>
    resolveCrossService({
      fromCliEnable: false,
      fromCliDisable: false,
      config: undefined,
      serviceCount: 0,
      ...o,
    });

  it("--no-cross-service forces OFF, beating config:true (the codex P2 case)", () => {
    expect(r({ fromCliDisable: true, config: true, serviceCount: 5 })).toBe(false);
  });

  it("--no-cross-service forces OFF, beating --cross-service (both flags → off)", () => {
    expect(r({ fromCliDisable: true, fromCliEnable: true, config: true, serviceCount: 5 })).toBe(false);
  });

  it("--no-cross-service forces OFF even with ≥2 services and no config", () => {
    expect(r({ fromCliDisable: true, serviceCount: 9 })).toBe(false);
  });

  it("--cross-service forces ON, beating config:false", () => {
    expect(r({ fromCliEnable: true, config: false, serviceCount: 0 })).toBe(true);
  });

  it("--cross-service forces ON even on a monolith (serviceCount 0)", () => {
    expect(r({ fromCliEnable: true, serviceCount: 0 })).toBe(true);
  });

  it("config:true (no flags) → ON, ignoring service count", () => {
    expect(r({ config: true, serviceCount: 0 })).toBe(true);
  });

  it("config:false (no flags) → OFF, ignoring service count", () => {
    expect(r({ config: false, serviceCount: 9 })).toBe(false);
  });

  it("AUTO (config absent, no flags): ON iff ≥2 services", () => {
    expect(r({ config: undefined, serviceCount: 2 })).toBe(true);
    expect(r({ config: undefined, serviceCount: 1 })).toBe(false);
    expect(r({ config: undefined, serviceCount: 0 })).toBe(false);
  });
});

// ── cross-service AUTO resolution (default-on when ≥2 services) ────────────

describe("main() cross-service AUTO resolution", () => {
  let tmpPath: string;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmpPath = makeTmpPath("atlas-inv-cs-auto-");
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });
  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    cleanupTmpPath(tmpPath);
  });

  /** A two-service repo (svc-a java + svc-b node) — ≥2 real services. */
  function writeMultiService(): void {
    fs.mkdirSync(path.join(tmpPath, "svc-a", "src"), { recursive: true });
    fs.writeFileSync(path.join(tmpPath, "svc-a", "pom.xml"), "<project><artifactId>svc-a</artifactId></project>");
    fs.writeFileSync(
      path.join(tmpPath, "svc-a", "src", "C.java"),
      '@RestController class C { @GetMapping("/a/ping") String p(){return "";} }',
    );
    fs.mkdirSync(path.join(tmpPath, "svc-b"), { recursive: true });
    fs.writeFileSync(path.join(tmpPath, "svc-b", "package.json"), '{"name":"svc-b"}');
  }

  /** A single-project monolith — 0/1 real services. */
  function writeMonolith(): void {
    fs.writeFileSync(path.join(tmpPath, "package.json"), '{"name":"x"}');
  }

  function readManifest(runId: string): CodeInventory {
    const manifest = loadInventory(tmpPath, runId);
    if (!manifest) throw new Error("manifest not found");
    return manifest;
  }

  function run(runId: string, ...extra: string[]): number {
    return main([
      "generate",
      "--wiki-root", tmpPath,
      "--repo-root", tmpPath,
      "--run-id", runId,
      ...extra,
    ]);
  }

  it("AUTO enables cross-service when ≥2 real services are discovered (no flag, no config)", () => {
    writeMultiService();
    const runId = "2026-06-09T00-00-00";
    expect(run(runId)).toBe(0);
    const ids = readManifest(runId).services.map((s) => s.identity.id).sort();
    expect(ids).toEqual(["svc-a", "svc-b"]);
  });

  it("AUTO disables cross-service for a monolith (0/1 services)", () => {
    writeMonolith();
    const runId = "2026-06-09T00-00-01";
    expect(run(runId)).toBe(0);
    expect(readManifest(runId).services).toEqual([]);
  });

  it("--no-cross-service suppresses even when ≥2 services are present", () => {
    writeMultiService();
    const runId = "2026-06-09T00-00-02";
    expect(run(runId, "--no-cross-service")).toBe(0);
    expect(readManifest(runId).services).toEqual([]);
  });

  it("--cross-service forces cross-service even when config disables it", () => {
    writeMultiService();
    fs.writeFileSync(
      path.join(tmpPath, "wiki.config.yaml"),
      "ecosystem:\n  cross_service:\n    enabled: false\n",
    );
    const runId = "2026-06-09T00-00-03";
    expect(run(runId, "--cross-service")).toBe(0);
    const ids = readManifest(runId).services.map((s) => s.identity.id).sort();
    expect(ids).toEqual(["svc-a", "svc-b"]);
  });

  it("config enabled:false suppresses cross-service even with ≥2 services", () => {
    writeMultiService();
    fs.writeFileSync(
      path.join(tmpPath, "wiki.config.yaml"),
      "ecosystem:\n  cross_service:\n    enabled: false\n",
    );
    const runId = "2026-06-09T00-00-04";
    expect(run(runId)).toBe(0);
    expect(readManifest(runId).services).toEqual([]);
  });

  it("config enabled:true forces cross-service even on a monolith (services may still be empty via no-scaffolding gate downstream)", () => {
    // On a monolith, discovery finds 0/1 services; config:true still flips the
    // generate flag on, but there is nothing to populate — services stays [].
    writeMonolith();
    fs.writeFileSync(
      path.join(tmpPath, "wiki.config.yaml"),
      "ecosystem:\n  cross_service:\n    enabled: true\n",
    );
    const runId = "2026-06-09T00-00-05";
    expect(run(runId)).toBe(0);
    expect(readManifest(runId).services).toEqual([]);
  });

  it("--no-cross-service beats config enabled:true (hard suppress)", () => {
    writeMultiService();
    fs.writeFileSync(
      path.join(tmpPath, "wiki.config.yaml"),
      "ecosystem:\n  cross_service:\n    enabled: true\n",
    );
    const runId = "2026-06-09T00-00-06";
    expect(run(runId, "--no-cross-service")).toBe(0);
    expect(readManifest(runId).services).toEqual([]);
  });

  // The resolved decision is PERSISTED into the manifest (the single source of
  // truth Phase 4/7 read). It must match resolveCrossService across the matrix.
  it("persists cross_service_enabled matching the resolved decision (AUTO-on, ≥2 services)", () => {
    writeMultiService();
    const runId = "2026-06-09T00-00-10";
    expect(run(runId)).toBe(0);
    expect(readManifest(runId).cross_service_enabled).toBe(true);
  });

  it("persists cross_service_enabled=false for a monolith (AUTO-off)", () => {
    writeMonolith();
    const runId = "2026-06-09T00-00-11";
    expect(run(runId)).toBe(0);
    expect(readManifest(runId).cross_service_enabled).toBe(false);
  });

  it("persists cross_service_enabled=false under --no-cross-service even with ≥2 services", () => {
    writeMultiService();
    const runId = "2026-06-09T00-00-12";
    expect(run(runId, "--no-cross-service")).toBe(0);
    expect(readManifest(runId).cross_service_enabled).toBe(false);
  });

  it("persists cross_service_enabled=true under --cross-service even with config false", () => {
    writeMultiService();
    fs.writeFileSync(path.join(tmpPath, "wiki.config.yaml"), "ecosystem:\n  cross_service:\n    enabled: false\n");
    const runId = "2026-06-09T00-00-13";
    expect(run(runId, "--cross-service")).toBe(0);
    expect(readManifest(runId).cross_service_enabled).toBe(true);
  });

  it("persists cross_service_enabled honoring config true / false", () => {
    writeMultiService();
    fs.writeFileSync(path.join(tmpPath, "wiki.config.yaml"), "ecosystem:\n  cross_service:\n    enabled: false\n");
    const runIdFalse = "2026-06-09T00-00-14";
    expect(run(runIdFalse)).toBe(0);
    expect(readManifest(runIdFalse).cross_service_enabled).toBe(false);

    fs.writeFileSync(path.join(tmpPath, "wiki.config.yaml"), "ecosystem:\n  cross_service:\n    enabled: true\n");
    const runIdTrue = "2026-06-09T00-00-15";
    expect(run(runIdTrue)).toBe(0);
    expect(readManifest(runIdTrue).cross_service_enabled).toBe(true);
  });
});

// ── resolved-cross-service printer: deterministic Phase-7 signal ──────────

describe("main() resolved-cross-service printer", () => {
  let tmpPath: string;
  let stdout: string[];
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmpPath = makeTmpPath("atlas-inv-rcs-");
    stdout = [];
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation((c) => { stdout.push(c.toString()); return true; });
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });
  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    cleanupTmpPath(tmpPath);
  });

  function writeMultiService(): void {
    fs.mkdirSync(path.join(tmpPath, "svc-a", "src"), { recursive: true });
    fs.writeFileSync(path.join(tmpPath, "svc-a", "pom.xml"), "<project><artifactId>svc-a</artifactId></project>");
    fs.writeFileSync(path.join(tmpPath, "svc-a", "src", "C.java"), '@RestController class C { @GetMapping("/a/ping") String p(){return "";} }');
    fs.mkdirSync(path.join(tmpPath, "svc-b"), { recursive: true });
    fs.writeFileSync(path.join(tmpPath, "svc-b", "package.json"), '{"name":"svc-b"}');
  }

  function gen(runId: string, ...extra: string[]): void {
    const exit = main(["generate", "--wiki-root", tmpPath, "--repo-root", tmpPath, "--run-id", runId, ...extra]);
    expect(exit).toBe(0);
    stdout.length = 0; // discard generate's manifest JSON
  }

  function printResolved(runId: string): string {
    const exit = main(["resolved-cross-service", "--wiki-root", tmpPath, "--run-id", runId]);
    expect(exit).toBe(0);
    return stdout.join("").trim();
  }

  it("prints true after an AUTO-on (≥2 services) generate", () => {
    writeMultiService();
    const runId = "2026-06-09T01-00-00";
    gen(runId);
    expect(printResolved(runId)).toBe("true");
  });

  it("prints false after a --no-cross-service generate (even with ≥2 services)", () => {
    writeMultiService();
    const runId = "2026-06-09T01-00-01";
    gen(runId, "--no-cross-service");
    expect(printResolved(runId)).toBe("false");
  });

  it("prints false when the manifest is missing", () => {
    expect(printResolved("2026-06-09T01-00-02")).toBe("false");
  });

  it("requires --run-id (exit 2)", () => {
    const exit = main(["resolved-cross-service", "--wiki-root", tmpPath]);
    expect(exit).toBe(2);
  });
});

// ── B7b: external_sources bucket + connector cross-reference ──────────────

describe("generateInventory external_sources (B7b)", () => {
  it("populates external_sources for a service with a DB datasource URL", () => {
    const root = makeTmpPath("ext-src-b7b");

    // A service with a Spring datasource config containing a postgresql URL.
    fs.mkdirSync(path.join(root, "common-service", "src", "main", "resources"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "common-service", "pom.xml"),
      "<project><artifactId>common-service</artifactId></project>",
    );
    fs.writeFileSync(
      path.join(root, "common-service", "src", "main", "resources", "application.yml"),
      "spring:\n  datasource:\n    url: jdbc:postgresql://pg/appdb\n",
    );

    // Write a .connectors/config.yaml enabling the db connector.
    const connDir = path.join(root, ".connectors");
    fs.mkdirSync(connDir, { recursive: true });
    const connConfigPath = path.join(connDir, "config.yaml");
    fs.writeFileSync(connConfigPath, "connectors:\n  db:\n    enabled: true\n");

    const inv = generateInventory(root, "2026-06-07T11-00-00", {
      enableCrossService: true,
      connectorsConfigPath: connConfigPath,
    });

    const svc = inv.services.find((s) => s.identity.id === "common-service");
    expect(svc).toBeDefined();
    const dbEntry = svc!.external_sources.find((e) => e.kind === "database");
    expect(dbEntry).toBeDefined();
    expect(dbEntry!.connector_id).toBe("db");
    expect(dbEntry!.configured).toBe(true);

    cleanupTmpPath(root);
  });

  it("marks configured:false when db connector is NOT enabled in config", () => {
    const root = makeTmpPath("ext-src-b7b-uncfg");

    fs.mkdirSync(path.join(root, "common-service", "src", "main", "resources"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "common-service", "pom.xml"),
      "<project><artifactId>common-service</artifactId></project>",
    );
    fs.writeFileSync(
      path.join(root, "common-service", "src", "main", "resources", "application.yml"),
      "spring:\n  datasource:\n    url: jdbc:postgresql://pg/appdb\n",
    );

    // No connectorsConfigPath provided → configured defaults to false.
    const inv = generateInventory(root, "2026-06-07T11-00-01", {
      enableCrossService: true,
      // connectorsConfigPath deliberately omitted
    });

    const svc = inv.services.find((s) => s.identity.id === "common-service");
    expect(svc).toBeDefined();
    const dbEntry = svc!.external_sources.find((e) => e.kind === "database");
    expect(dbEntry).toBeDefined();
    expect(dbEntry!.connector_id).toBe("db");
    expect(dbEntry!.configured).toBe(false);

    cleanupTmpPath(root);
  });

  it("external_sources is empty when enableCrossService is false", () => {
    const root = makeTmpPath("ext-src-no-cs");
    fs.writeFileSync(path.join(root, "package.json"), '{"name":"x"}');
    const inv = generateInventory(root, "2026-06-07T11-00-02", { enableCrossService: false });
    // services array is empty, so there are no external_sources to check —
    // but the top-level inventory still shouldn't have the key.
    expect(inv.services).toEqual([]);
    cleanupTmpPath(root);
  });
});

// ── B7b-perservice: per-service detectExternalSources walk (PR #58 review) ──

describe("generateInventory external_sources per-service scan (B7b-perservice)", () => {
  it("detects datasource entries for BOTH services in a 2-service repo", () => {
    const root = makeTmpPath("ext-src-perservice");

    // Service A: jdbc:postgresql
    fs.mkdirSync(path.join(root, "svc-a", "src", "main", "resources"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "svc-a", "pom.xml"),
      "<project><artifactId>svc-a</artifactId></project>",
    );
    fs.writeFileSync(
      path.join(root, "svc-a", "src", "main", "resources", "application.yml"),
      "spring:\n  datasource:\n    url: jdbc:postgresql://pg-a/svc_a_db\n",
    );

    // Service B: jdbc:mysql
    fs.mkdirSync(path.join(root, "svc-b", "src", "main", "resources"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "svc-b", "pom.xml"),
      "<project><artifactId>svc-b</artifactId></project>",
    );
    fs.writeFileSync(
      path.join(root, "svc-b", "src", "main", "resources", "application.yml"),
      "spring:\n  datasource:\n    url: jdbc:mysql://mysql-b/svc_b_db\n",
    );

    const inv = generateInventory(root, "2026-06-08T10-00-00", {
      enableCrossService: true,
    });

    const svcA = inv.services.find((s) => s.identity.id === "svc-a");
    const svcB = inv.services.find((s) => s.identity.id === "svc-b");
    expect(svcA).toBeDefined();
    expect(svcB).toBeDefined();

    // Both services must have a database entry — proving per-service scanning.
    const dbA = svcA!.external_sources.find((e) => e.kind === "database");
    const dbB = svcB!.external_sources.find((e) => e.kind === "database");
    expect(dbA).toBeDefined();
    expect(dbB).toBeDefined();

    // Entries are owner-tagged to the right service (file path starts with svc root).
    expect(dbA!.file.startsWith("svc-a/")).toBe(true);
    expect(dbB!.file.startsWith("svc-b/")).toBe(true);

    cleanupTmpPath(root);
  });
});

// ── Fix 1: per-service queue-const isolation + shared-library resolution ──

describe("generateInventory cross-service queue-name resolution (Fix 1)", () => {
  it("resolves same-named queue constants per-service, not repo-wide (no cross-bleed)", () => {
    const root = makeTmpPath("ctx-isolate");
    for (const [svc, val] of [["svc-a", "a-queue"], ["svc-b", "b-queue"]] as const) {
      fs.mkdirSync(path.join(root, svc, "src"), { recursive: true });
      fs.writeFileSync(path.join(root, svc, "pom.xml"), `<project><artifactId>${svc}</artifactId></project>`);
      fs.writeFileSync(path.join(root, svc, "src", "C.java"),
        `public static final String Q = "${val}";\n@RabbitListener(queues = Q)\nvoid h(Dto m){}`);
    }
    const inv = generateInventory(root, "2026-06-07T10-00-00", { enableCrossService: true });
    const a = inv.services.find((s) => s.identity.id === "svc-a")!;
    const b = inv.services.find((s) => s.identity.id === "svc-b")!;
    expect(a.queue_endpoints.find((e) => e.role === "consumer")?.queue_name).toBe("a-queue");
    expect(b.queue_endpoints.find((e) => e.role === "consumer")?.queue_name).toBe("b-queue");
    cleanupTmpPath(root);
  });

  it("resolves a shared-library queue constant for a consuming service", () => {
    const root = makeTmpPath("ctx-sharedlib");
    fs.mkdirSync(path.join(root, "shared", "msg", "src"), { recursive: true });
    fs.writeFileSync(path.join(root, "shared", "msg", "pom.xml"),
      "<project><groupId>com.x.shared</groupId><artifactId>msg</artifactId></project>");
    fs.writeFileSync(path.join(root, "shared", "msg", "src", "Q.java"),
      'public static final String SHARED_Q = "shared-events";');
    fs.mkdirSync(path.join(root, "svc-a", "src"), { recursive: true });
    fs.writeFileSync(path.join(root, "svc-a", "pom.xml"), "<project><artifactId>svc-a</artifactId></project>");
    fs.writeFileSync(path.join(root, "svc-a", "src", "L.java"),
      'import com.x.shared.msg.Q;\n@RabbitListener(queues = SHARED_Q)\nvoid h(Dto m){}');
    const inv = generateInventory(root, "2026-06-07T10-00-01", { enableCrossService: true });
    const a = inv.services.find((s) => s.identity.id === "svc-a")!;
    expect(a.queue_endpoints.find((e) => e.role === "consumer")?.queue_name).toBe("shared-events");
    cleanupTmpPath(root);
  });

  it("enableCrossService implies REST detection so client->endpoint calls edges work (frontend->backend)", () => {
    const root = makeTmpPath("xs-implies-rest");
    // Vue frontend calling a backend endpoint via the gateway path
    fs.mkdirSync(path.join(root, "admin-ui", "src"), { recursive: true });
    fs.writeFileSync(path.join(root, "admin-ui", "package.json"), '{"name":"admin-ui","dependencies":{"vue":"^3"}}');
    fs.writeFileSync(path.join(root, "admin-ui", "src", "api.ts"),
      'import axios from "axios";\nawait axios.get("/api/payments/invoices/42");');
    // Backend exposing the endpoint
    fs.mkdirSync(path.join(root, "payments-module", "src"), { recursive: true });
    fs.writeFileSync(path.join(root, "payments-module", "pom.xml"), "<project><artifactId>payments-module</artifactId></project>");
    fs.writeFileSync(path.join(root, "payments-module", "src", "R.java"),
      '@RestController class R { @GetMapping("/api/payments/invoices/{id}") String g(){return"";} }');
    // NOTE: enableRest is NOT passed — enableCrossService must imply it.
    const inv = generateInventory(root, "2026-06-07T10-00-02", { enableCrossService: true });
    const billing = inv.services.find((s) => s.identity.id === "payments-module")!;
    expect(billing.rest_endpoints.length).toBeGreaterThan(0);    // REST ran despite enableRest unset
    const g = buildServiceGraph(inv);
    const fe = g.edges.find((e) => e.kind === "calls" && e.from_service === "admin-ui" && e.to_service === "payments-module");
    expect(fe).toBeTruthy();                                     // frontend -> backend edge present
    expect(fe!.confidence).toBe("high");
    cleanupTmpPath(root);
  });
});

// ── library_deps + auth_issuer inventory fields (Task C2b) ────────────

describe("generateInventory library_deps + auth_issuer fields (C2b)", () => {
  it("populates library_deps from pom.xml <dependency> blocks matching discovered library ids", () => {
    const root = makeTmpPath("c2b-libdeps");

    // Discovered library: shared/common-model with artifactId common-model
    fs.mkdirSync(path.join(root, "shared", "common-model", "src"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "shared", "common-model", "pom.xml"),
      `<project>
  <groupId>com.x.shared</groupId>
  <artifactId>common-model</artifactId>
  <version>1.0</version>
  <packaging>jar</packaging>
</project>`,
    );

    // svc-a depends on common-model
    fs.mkdirSync(path.join(root, "svc-a", "src", "main", "resources"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "svc-a", "pom.xml"),
      `<project>
  <artifactId>svc-a</artifactId>
  <dependencies>
    <dependency>
      <groupId>com.x.shared</groupId>
      <artifactId>common-model</artifactId>
    </dependency>
  </dependencies>
</project>`,
    );
    fs.writeFileSync(
      path.join(root, "svc-a", "src", "main", "resources", "application.yml"),
      `spring:
  security:
    oauth2:
      resourceserver:
        jwt:
          issuer-uri: https://auth.example.com/
`,
    );

    const inv = generateInventory(root, "2026-06-07T10-00-00", { enableCrossService: true });

    const svcA = inv.services.find((s) => s.identity.id === "svc-a");
    expect(svcA).toBeDefined();
    expect(svcA!.library_deps).toContain("common-model");
    expect(svcA!.auth_issuer).toBe("https://auth.example.com/");

    // The library itself should have empty library_deps (it has no pom dependency on itself)
    const lib = inv.services.find((s) => s.identity.id === "common-model");
    expect(lib).toBeDefined();
    expect(lib!.library_deps).toEqual([]);

    cleanupTmpPath(root);
  });

  it("auth_issuer falls back to issuer_uri (underscore) property key", () => {
    const root = makeTmpPath("c2b-issuer-underscore");
    fs.mkdirSync(path.join(root, "svc-b", "src", "main", "resources"), { recursive: true });
    fs.writeFileSync(path.join(root, "svc-b", "pom.xml"), "<project><artifactId>svc-b</artifactId></project>");
    // Use dots-mapped as underscores in properties file
    fs.writeFileSync(
      path.join(root, "svc-b", "src", "main", "resources", "application.properties"),
      "spring.security.oauth2.resourceserver.jwt.issuer-uri=https://example.okta.com/\n",
    );
    const inv = generateInventory(root, "2026-06-07T10-00-01", { enableCrossService: true });
    const svcB = inv.services.find((s) => s.identity.id === "svc-b");
    expect(svcB).toBeDefined();
    expect(svcB!.auth_issuer).toBe("https://example.okta.com/");
    cleanupTmpPath(root);
  });

  it("library_deps is empty when service pom has no matching library dependency", () => {
    const root = makeTmpPath("c2b-no-deps");
    fs.mkdirSync(path.join(root, "svc-c", "src"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "svc-c", "pom.xml"),
      `<project>
  <artifactId>svc-c</artifactId>
  <dependencies>
    <dependency>
      <groupId>org.external</groupId>
      <artifactId>some-lib</artifactId>
    </dependency>
  </dependencies>
</project>`,
    );
    const inv = generateInventory(root, "2026-06-07T10-00-02", { enableCrossService: true });
    const svcC = inv.services.find((s) => s.identity.id === "svc-c");
    expect(svcC).toBeDefined();
    expect(svcC!.library_deps).toEqual([]);
    cleanupTmpPath(root);
  });
});

// ── nested-pom library_deps (PR #58 Finding 2) ───────────────────

it("reads library_deps from a nested-pom service (build-subdir layout)", () => {
  const root = makeTmpPath("nested-libdeps");
  // a discovered library
  fs.mkdirSync(path.join(root, "shared", "common-model"), { recursive: true });
  fs.writeFileSync(path.join(root, "shared", "common-model", "pom.xml"),
    "<project><groupId>com.x.shared</groupId><artifactId>common-model</artifactId></project>");
  // a nested-pom service: pom is in feed/project/, not feed/
  fs.mkdirSync(path.join(root, "feed", "project", "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "feed", "project", "pom.xml"),
    "<project><artifactId>feed</artifactId><dependencies><dependency><groupId>com.x.shared</groupId><artifactId>common-model</artifactId></dependency></dependencies></project>");
  const inv = generateInventory(root, "2026-06-08T10-00-00", { enableCrossService: true });
  const feed = inv.services.find((s) => s.identity.id === "feed")!;
  expect(feed).toBeDefined();
  expect(feed.library_deps).toContain("common-model");
  cleanupTmpPath(root);
});

// ── _readEcosystemCrossServiceEnabled ─────────────────────────────

describe("_readEcosystemCrossServiceEnabled", () => {
  it("reads ecosystem.cross_service.enabled from wiki.config.yaml", () => {
    const root = makeTmpPath("xs-flag");
    fs.writeFileSync(path.join(root, "wiki.config.yaml"), "ecosystem:\n  cross_service:\n    enabled: true\n");
    expect(_readEcosystemCrossServiceEnabled(root)).toBe(true);
    const root2 = makeTmpPath("xs-flag2");
    fs.writeFileSync(path.join(root2, "wiki.config.yaml"), "ecosystem:\n  rest:\n    enabled: true\n");
    expect(_readEcosystemCrossServiceEnabled(root2)).toBe(false);   // absent → false
    cleanupTmpPath(root); cleanupTmpPath(root2);
  });

  it("CLI --cross-service runs cross-service detection (services populated)", () => {
    const root = makeTmpPath("xs-cli-repo");
    const wiki = makeTmpPath("xs-cli-wiki");
    fs.mkdirSync(path.join(root, "svc-a", "src"), { recursive: true });
    fs.writeFileSync(path.join(root, "svc-a", "pom.xml"), "<project><artifactId>svc-a</artifactId></project>");
    fs.writeFileSync(path.join(root, "svc-a", "src", "R.java"), '@RestController class R { @GetMapping("/a/x") String g(){return"";} }');
    const code = main(["generate", "--wiki-root", wiki, "--repo-root", root, "--run-id", "2026-06-07T10-00-00", "--cross-service"]);
    expect(code).toBe(0);
    const inv = loadInventory(wiki, "2026-06-07T10-00-00")!;
    expect(inv.services.length).toBeGreaterThan(0);   // cross-service ran
    cleanupTmpPath(root); cleanupTmpPath(wiki);
  });
});

describe("_countLinesTo", () => {
  // The reference implementation this replaced. Every case below asserts
  // equivalence against it rather than against a hand-computed number, so a
  // future rewrite of the backward scan can't silently drift.
  const reference = (s: string, idx: number): number =>
    s.slice(0, idx).split("\n").length;

  const cases: Array<[string, string, number]> = [
    ["empty string", "", 0],
    ["index 0 is line 1", "abc", 0],
    ["single line, no newline", "abc", 2],
    ["second line", "a\nb", 2],
    ["leading newline", "\nabc", 3],
    ["consecutive newlines", "a\n\nb", 3],
    ["trailing newline", "a\n", 2],
    ["index on the newline itself", "a\nb", 1],
    ["index just past a newline", "a\nb", 2],
    ["many lines", "l1\nl2\nl3\nl4\nl5", 11],
    ["CRLF line endings", "a\r\nb\r\nc", 6],
    ["index at end of string", "a\nb\nc", 5],
  ];

  for (const [name, str, idx] of cases) {
    it(`matches slice().split() — ${name}`, () => {
      expect(_countLinesTo(str, idx)).toBe(reference(str, idx));
    });
  }

  it("matches slice().split() across every index of a multi-line string", () => {
    const s = "alpha\nbravo\n\ncharlie\n\n\ndelta\n";
    for (let i = 0; i <= s.length; i++) {
      expect(_countLinesTo(s, i)).toBe(reference(s, i));
    }
  });

  it("does not allocate per call on a large input", () => {
    // 200k lines: the .slice().split() form allocated a copy of the prefix
    // plus an array of every line on each match. Guard against a regression
    // to that shape by asserting this stays fast on a large buffer.
    const big = "x\n".repeat(200_000);
    const started = performance.now();
    expect(_countLinesTo(big, big.length)).toBe(200_001);
    expect(performance.now() - started).toBeLessThan(500);
  });
});
