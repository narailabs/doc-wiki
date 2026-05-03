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

  it("extracts @app.route(methods=) and @app.<verb> shorthand", () => {
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
`,
    );
    const profile = loadRestProfile("flask")!;
    const eps = detectRestEndpoints(tmpPath, [profile]);
    const tuples = eps.map((e) => `${e.method} ${e.path}`);
    expect(tuples).toContain("GET /api/users");
    expect(tuples).toContain("POST /api/users");
    expect(tuples).toContain("GET /api/users/<int:user_id>");
    expect(tuples).toContain("DELETE /api/users/<int:user_id>");
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

  it("extracts [HttpVerb] attribute routes", () => {
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
