/**
 * Tests for --env dispatch (G-DB-AGENT-ENV).
 *
 * Exercises the new path where db_query reads `wiki.config.yaml`, resolves
 * `ecosystem.database.environments[name]`, registers the env with wiki_db,
 * and runs the query through `connection.getConnection`.
 *
 * Uses sqlite-backed envs (driver: sqlite, database: <path>) so the tests
 * are self-contained — no Docker, no network, no credentials required.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import Database from "better-sqlite3";

import { main } from "../db_query.js";
import { clearEnvironments } from "../../../lib/wiki_db/environments.js";

async function captureStdout(fn: () => void | Promise<void>): Promise<string> {
  const orig = process.stdout.write.bind(process.stdout);
  const chunks: string[] = [];
  process.stdout.write = ((s: string | Uint8Array): boolean => {
    chunks.push(typeof s === "string" ? s : Buffer.from(s).toString("utf-8"));
    return true;
  }) as typeof process.stdout.write;
  try {
    await fn();
  } finally {
    process.stdout.write = orig;
  }
  return chunks.join("");
}

async function captureStderr(fn: () => void | Promise<void>): Promise<string> {
  const orig = process.stderr.write.bind(process.stderr);
  const chunks: string[] = [];
  process.stderr.write = ((s: string | Uint8Array): boolean => {
    chunks.push(typeof s === "string" ? s : Buffer.from(s).toString("utf-8"));
    return true;
  }) as typeof process.stderr.write;
  try {
    await fn();
  } finally {
    process.stderr.write = orig;
  }
  return chunks.join("");
}

function makeFixtureDb(tmp: string): string {
  const dbPath = path.join(tmp, "test.db");
  const db = new Database(dbPath);
  db.exec(
    "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL);",
  );
  db.prepare("INSERT INTO users (name) VALUES (?)").run("Alice");
  db.prepare("INSERT INTO users (name) VALUES (?)").run("Bob");
  db.close();
  return dbPath;
}

function makeConfig(
  tmp: string,
  envs: Record<string, Record<string, unknown>>,
): string {
  const configPath = path.join(tmp, "wiki.config.yaml");
  // YAML indent levels: ecosystem(0) → database(2) → environments(4) →
  // envName(6) → fields(8). Each `    ` = 4 spaces.
  const envsYaml = Object.entries(envs)
    .map(([name, cfg]) => {
      const lines = [`      ${name}:`];
      for (const [k, v] of Object.entries(cfg)) {
        const val = typeof v === "string" ? `"${v}"` : String(v);
        lines.push(`        ${k}: ${val}`);
      }
      return lines.join("\n");
    })
    .join("\n");
  const body = `wiki:
  name: Test Wiki
  domain: test

ecosystem:
  database:
    enabled: true
    environments:
${envsYaml}
`;
  fs.writeFileSync(configPath, body, "utf-8");
  return configPath;
}

describe("db_query --env dispatch (G-DB-AGENT-ENV)", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "db-query-env-"));
    clearEnvironments();
  });
  afterEach(() => {
    clearEnvironments();
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  });

  it("--env resolves sqlite driver and runs SELECT", async () => {
    const dbPath = makeFixtureDb(tmp);
    const configPath = makeConfig(tmp, {
      dev: {
        driver: "sqlite",
        database: dbPath,
        schema: "",
        approval_mode: "auto",
      },
    });
    const stdout = await captureStdout(async () => {
      const code = await main([
        "--env",
        "dev",
        "--config",
        configPath,
        "--sql",
        "SELECT name FROM users WHERE id >= 1 ORDER BY id",
      ]);
      expect(code).toBe(0);
    });
    const result = JSON.parse(stdout) as {
      status: string;
      rows: Array<{ name: string }>;
    };
    expect(result.status).toBe("ok");
    expect(result.rows.map((r) => r.name)).toEqual(["Alice", "Bob"]);
  });

  it("--env DDL is denied (policy gate)", async () => {
    const dbPath = makeFixtureDb(tmp);
    const configPath = makeConfig(tmp, {
      dev: {
        driver: "sqlite",
        database: dbPath,
        schema: "",
        approval_mode: "auto",
      },
    });
    const stdout = await captureStdout(async () => {
      const code = await main([
        "--env",
        "dev",
        "--config",
        configPath,
        "--sql",
        "DROP TABLE users",
      ]);
      expect(code).toBe(1);
    });
    const result = JSON.parse(stdout) as { status: string };
    expect(result.status).toBe("denied");
  });

  it("--env DML returns present_only", async () => {
    const dbPath = makeFixtureDb(tmp);
    const configPath = makeConfig(tmp, {
      dev: {
        driver: "sqlite",
        database: dbPath,
        schema: "",
        approval_mode: "auto",
      },
    });
    const stdout = await captureStdout(async () => {
      const code = await main([
        "--env",
        "dev",
        "--config",
        configPath,
        "--sql",
        "INSERT INTO users (name) VALUES ('Eve')",
      ]);
      expect(code).toBe(0);
    });
    const result = JSON.parse(stdout) as {
      status: string;
      formatted_sql?: string;
    };
    expect(result.status).toBe("present_only");
    expect(result.formatted_sql).toMatch(/^INSERT /);
  });

  it("--env uses approval_mode from config when --approval-mode not set", async () => {
    // confirm_each escalates every read
    const dbPath = makeFixtureDb(tmp);
    const configPath = makeConfig(tmp, {
      staging: {
        driver: "sqlite",
        database: dbPath,
        schema: "",
        approval_mode: "confirm_each",
      },
    });
    const stdout = await captureStdout(async () => {
      const code = await main([
        "--env",
        "staging",
        "--config",
        configPath,
        "--sql",
        "SELECT name FROM users WHERE id = 1",
      ]);
      expect(code).toBe(1);
    });
    const result = JSON.parse(stdout) as { status: string };
    expect(result.status).toBe("escalate");
  });

  it("--env with kebab-case approval mode normalizes to snake_case", async () => {
    // v2 YAML uses "grant-required"; wiki_db expects "grant_required"
    const dbPath = makeFixtureDb(tmp);
    const configPath = makeConfig(tmp, {
      prod: {
        driver: "sqlite",
        database: dbPath,
        schema: "",
        approval_mode: "grant-required",
      },
    });
    const stdout = await captureStdout(async () => {
      const code = await main([
        "--env",
        "prod",
        "--config",
        configPath,
        "--sql",
        "SELECT name FROM users WHERE id = 1",
      ]);
      expect(code).toBe(1);
    });
    const result = JSON.parse(stdout) as { status: string };
    // No active grant → READ is denied under grant_required
    expect(result.status).toBe("denied");
  });

  it("--env and --sqlite are mutually exclusive", async () => {
    const stderr = await captureStderr(async () => {
      const code = await main([
        "--env",
        "dev",
        "--sqlite",
        ":memory:",
        "--sql",
        "SELECT 1",
      ]);
      expect(code).toBe(2);
    });
    expect(stderr).toMatch(/mutually exclusive/);
  });

  it("--env unknown environment produces clear error", async () => {
    const configPath = makeConfig(tmp, {
      dev: {
        driver: "sqlite",
        database: ":memory:",
        schema: "",
        approval_mode: "auto",
      },
    });
    const stderr = await captureStderr(async () => {
      const code = await main([
        "--env",
        "ghost",
        "--config",
        configPath,
        "--sql",
        "SELECT 1",
      ]);
      expect(code).toBe(2);
    });
    expect(stderr).toMatch(/environment 'ghost' not found/);
  });

  it("--action schema via --env returns tables + mermaid", async () => {
    const dbPath = makeFixtureDb(tmp);
    const configPath = makeConfig(tmp, {
      dev: {
        driver: "sqlite",
        database: dbPath,
        schema: "",
        approval_mode: "auto",
      },
    });
    const stdout = await captureStdout(async () => {
      const code = await main([
        "--env",
        "dev",
        "--config",
        configPath,
        "--action",
        "schema",
      ]);
      expect(code).toBe(0);
    });
    const result = JSON.parse(stdout) as {
      status: string;
      table_count: number;
      mermaid?: { type: string };
    };
    expect(result.status).toBe("ok");
    expect(result.table_count).toBe(1);
    expect(result.mermaid?.type).toBe("erDiagram");
  });
});
