/**
 * Tests for db_query.ts — the wiki-db-agent CLI shim.
 *
 * Exercises the policy gate + SQLite driver path end-to-end. Uses the
 * :memory: SQLite backend so tests are self-contained and fast.
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";

import { main } from "../db_query.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SCRIPTS_DIR = path.resolve(__dirname, "..");
const CLI = path.join(SCRIPTS_DIR, "db_query.js");

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

function makeFixtureDb(): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "db-query-test-"));
  const dbPath = path.join(tmp, "test.db");
  const db = new Database(dbPath);
  db.exec(
    "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT);",
  );
  db.prepare("INSERT INTO users (name, email) VALUES (?, ?)").run(
    "Alice",
    "alice@example.com",
  );
  db.prepare("INSERT INTO users (name, email) VALUES (?, ?)").run(
    "Bob",
    "bob@example.com",
  );
  db.close();
  return dbPath;
}

function runCli(args: readonly string[]): {
  stdout: string;
  stderr: string;
  status: number;
} {
  try {
    const stdout = execFileSync("node", [CLI, ...args], {
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

describe("db_query main()", () => {
  it("requires --sqlite", async () => {
    const origErr = process.stderr.write.bind(process.stderr);
    const errChunks: string[] = [];
    process.stderr.write = ((s: string | Uint8Array): boolean => {
      errChunks.push(
        typeof s === "string" ? s : Buffer.from(s).toString("utf-8"),
      );
      return true;
    }) as typeof process.stderr.write;
    try {
      const code = await main([]);
      expect(code).toBe(2);
      expect(errChunks.join("")).toContain("--sqlite");
    } finally {
      process.stderr.write = origErr;
    }
  });

  it("runs a read query and returns structured JSON", async () => {
    const dbPath = makeFixtureDb();
    try {
      const stdout = await captureStdout(async () => {
        const code = await main([
          "--sqlite",
          dbPath,
          "--sql",
          "SELECT id, name, email FROM users WHERE id > 0 ORDER BY id LIMIT 10",
        ]);
        expect(code).toBe(0);
      });
      const result = JSON.parse(stdout);
      expect(result.status).toBe("ok");
      expect(result.row_count).toBe(2);
      expect(result.columns).toEqual(["id", "name", "email"]);
      expect((result.rows as Array<{ name: string }>)[0]!.name).toBe("Alice");
    } finally {
      fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
    }
  });

  it("escalates unbounded SELECT (no WHERE/LIMIT)", async () => {
    const dbPath = makeFixtureDb();
    try {
      const stdout = await captureStdout(async () => {
        await main(["--sqlite", dbPath, "--sql", "SELECT * FROM users"]);
      });
      const result = JSON.parse(stdout);
      expect(result.status).toBe("escalate");
      expect(result.reason).toContain("Unbounded");
    } finally {
      fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
    }
  });

  it("blocks DDL with status=denied", async () => {
    const dbPath = makeFixtureDb();
    try {
      const stdout = await captureStdout(async () => {
        const code = await main([
          "--sqlite",
          dbPath,
          "--sql",
          "DROP TABLE users",
        ]);
        expect(code).toBe(1);
      });
      const result = JSON.parse(stdout);
      expect(result.status).toBe("denied");
    } finally {
      fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
    }
  });

  it("returns DML as present_only (never executes)", async () => {
    const dbPath = makeFixtureDb();
    try {
      const stdout = await captureStdout(async () => {
        const code = await main([
          "--sqlite",
          dbPath,
          "--sql",
          "INSERT INTO users (name) VALUES ('Mallory')",
        ]);
        expect(code).toBe(0);
      });
      const result = JSON.parse(stdout);
      expect(result.status).toBe("present_only");
      expect(result.formatted_sql).toContain("INSERT");
      // Row count must not have changed.
      const db = new Database(dbPath);
      const count = db
        .prepare("SELECT COUNT(*) AS c FROM users")
        .get() as { c: number };
      expect(count.c).toBe(2);
      db.close();
    } finally {
      fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
    }
  });

  it("--action schema returns table metadata", async () => {
    const dbPath = makeFixtureDb();
    try {
      const stdout = await captureStdout(async () => {
        const code = await main([
          "--sqlite",
          dbPath,
          "--action",
          "schema",
        ]);
        expect(code).toBe(0);
      });
      const result = JSON.parse(stdout);
      expect(result.status).toBe("ok");
      expect(result.table_count).toBeGreaterThanOrEqual(1);
      const names = (result.tables as Array<{ name: string }>).map((t) => t.name);
      expect(names).toContain("users");
    } finally {
      fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
    }
  });

  it("--action schema emits a mermaid erDiagram field (G1)", async () => {
    const dbPath = makeFixtureDb();
    try {
      const stdout = await captureStdout(async () => {
        await main(["--sqlite", dbPath, "--action", "schema"]);
      });
      const result = JSON.parse(stdout);
      expect(result.mermaid).toBeDefined();
      expect(result.mermaid.type).toBe("erDiagram");
      expect(result.mermaid.title).toBe("Database Schema");
      expect(result.mermaid.code).toContain("erDiagram");
      expect(result.mermaid.code).toContain("users");
    } finally {
      fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
    }
  });

  it("rejects invalid --approval-mode", async () => {
    const dbPath = makeFixtureDb();
    const origErr = process.stderr.write.bind(process.stderr);
    const errChunks: string[] = [];
    process.stderr.write = ((s: string | Uint8Array): boolean => {
      errChunks.push(
        typeof s === "string" ? s : Buffer.from(s).toString("utf-8"),
      );
      return true;
    }) as typeof process.stderr.write;
    try {
      const code = await main([
        "--sqlite",
        dbPath,
        "--sql",
        "SELECT 1",
        "--approval-mode",
        "bogus",
      ]);
      expect(code).toBe(2);
      expect(errChunks.join("")).toContain("bogus");
    } finally {
      process.stderr.write = origErr;
      fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
    }
  });
});

describe("db_query CLI", () => {
  it("prints help with --help", () => {
    if (!fs.existsSync(CLI)) return; // only runs after npm run build
    const { stdout, status } = runCli(["--help"]);
    expect(status).toBe(0);
    expect(stdout).toContain("db_query");
    expect(stdout).toContain("--sqlite");
  });
});
