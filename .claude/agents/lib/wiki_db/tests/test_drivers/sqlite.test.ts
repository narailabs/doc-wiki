/**
 * Tests for drivers/sqlite.ts — ported 1:1 from `test_drivers/test_sqlite.py`.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type Database from "better-sqlite3";

import { SQLiteDriver } from "../../drivers/sqlite.js";

describe("wiki_db.drivers.sqlite", () => {
  let driver: SQLiteDriver;
  let conn: Database.Database | null = null;

  beforeEach(() => {
    driver = new SQLiteDriver();
    const c = driver.connect({ database: ":memory:" });
    c.exec(
      "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, email TEXT NOT NULL)",
    );
    c.exec("INSERT INTO users VALUES (1, 'Alice', 'alice@test.com')");
    c.exec("INSERT INTO users VALUES (2, 'Bob', 'bob@test.com')");
    c.exec("INSERT INTO users VALUES (3, 'Charlie', 'charlie@test.com')");
    conn = c;
  });
  afterEach(() => {
    if (conn) driver.close(conn);
    conn = null;
  });

  // --- TestConnect ---
  describe("TestConnect", () => {
    it("test_connect_in_memory", () => {
      const c = driver.connect({ database: ":memory:" });
      expect(c).not.toBeNull();
      driver.close(c);
    });
  });

  // --- TestExecuteRead ---
  describe("TestExecuteRead", () => {
    it("test_returns_result_dict", () => {
      const result = driver.executeRead(conn, "SELECT * FROM users WHERE id = 1");
      expect(result.status).toBe("success");
      expect(result).toHaveProperty("rows");
      expect(result).toHaveProperty("row_count");
      expect(result).toHaveProperty("columns");
      expect(result).toHaveProperty("execution_time_ms");
      expect(result).toHaveProperty("truncated");
    });

    it("test_with_params", () => {
      const result = driver.executeRead(
        conn,
        "SELECT * FROM users WHERE name = ?",
        ["Alice"],
      );
      expect(result.row_count).toBe(1);
      expect(result.rows![0]!["name"]).toBe("Alice");
    });

    it("test_max_rows", () => {
      const result = driver.executeRead(conn, "SELECT * FROM users", null, 2);
      expect(result.row_count).toBe(2);
      expect(result.truncated).toBe(true);
    });

    it("test_empty_result", () => {
      const result = driver.executeRead(conn, "SELECT * FROM users WHERE id = 999");
      expect(result.row_count).toBe(0);
      expect(result.rows).toEqual([]);
      expect(result.truncated).toBe(false);
    });

    it("test_error_returns_error_dict", () => {
      const result = driver.executeRead(conn, "SELECT * FROM nonexistent_table");
      expect(result.status).toBe("error");
      expect(result).toHaveProperty("error_code");
      expect(result).toHaveProperty("error");
    });
  });

  // --- TestGetSchema ---
  describe("TestGetSchema", () => {
    it("test_returns_tables", () => {
      const tables = driver.getSchema(conn);
      expect(tables.length).toBeGreaterThanOrEqual(1);
      const names = tables.map((t) => t.name);
      expect(names).toContain("users");
    });

    it("test_includes_columns", () => {
      const tables = driver.getSchema(conn);
      const users = tables.filter((t) => t.name === "users")[0];
      expect(users).toBeDefined();
      const colNames = users!.columns.map((c) => c.name);
      expect(colNames).toContain("id");
      expect(colNames).toContain("name");
      expect(colNames).toContain("email");
    });

    it("test_with_filter", () => {
      conn!.exec("CREATE TABLE orders (id INTEGER PRIMARY KEY)");
      const tables = driver.getSchema(conn, "", "user%");
      const names = tables.map((t) => t.name);
      expect(names).toContain("users");
      expect(names).not.toContain("orders");
    });
  });

  // --- TestClose ---
  describe("TestClose", () => {
    it("test_close_connection", () => {
      const c = driver.connect({ database: ":memory:" });
      expect(() => driver.close(c)).not.toThrow();
    });
  });

  // --- TestFullIntegration ---
  describe("TestFullIntegration", () => {
    it("test_create_query_verify", () => {
      const c = driver.connect({ database: ":memory:" });
      c.exec(
        "CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT, price REAL)",
      );
      c.exec("INSERT INTO products VALUES (1, 'Widget', 9.99)");

      const result = driver.executeRead(
        c,
        "SELECT * FROM products WHERE id = ?",
        [1],
      );
      expect(result.status).toBe("success");
      expect(result.rows![0]!["name"]).toBe("Widget");
      expect(result.rows![0]!["price"]).toBe(9.99);

      const tables = driver.getSchema(c);
      expect(tables.some((t) => t.name === "products")).toBe(true);

      driver.close(c);
    });
  });
});
