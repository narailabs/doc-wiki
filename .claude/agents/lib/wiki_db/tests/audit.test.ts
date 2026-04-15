/**
 * Tests for audit.ts — ported 1:1 from `test_audit.py`.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  disableAudit,
  enableAudit,
  logEvent,
  logQuery,
  scrubSqlSecrets,
} from "../audit.js";
import { cleanupTmpPath, makeTmpPath } from "./fixtures.js";

describe("wiki_db.audit", () => {
  let tmpPath: string;

  // pytest: autouse=True _clean_audit
  beforeEach(() => {
    disableAudit();
    tmpPath = makeTmpPath("wiki-db-audit-");
  });
  afterEach(() => {
    disableAudit();
    cleanupTmpPath(tmpPath);
  });

  // ---------- 1. enable_disable ----------
  it("test_enable_disable", () => {
    const logPath = path.join(tmpPath, "audit.jsonl");
    enableAudit(logPath, "abc123");
    logQuery({
      env: "dev",
      query: "SELECT 1",
      status: "ok",
      row_count: 1,
      execution_time_ms: 5,
    });
    disableAudit();
    // After disable, further writes should be no-ops.
    logQuery({
      env: "dev",
      query: "SELECT 2",
      status: "ok",
      row_count: 1,
      execution_time_ms: 3,
    });
    const lines = fs.readFileSync(logPath, "utf-8").trim().split("\n");
    expect(lines.length).toBe(1);
  });

  // ---------- 2. disabled_by_default ----------
  it("test_disabled_by_default", () => {
    const logPath = path.join(tmpPath, "audit.jsonl");
    // Should not raise and should not create the file.
    logQuery({
      env: "dev",
      query: "SELECT 1",
      status: "ok",
      row_count: 0,
      execution_time_ms: 1,
    });
    expect(fs.existsSync(logPath)).toBe(false);
  });

  // ---------- 3. log_query_event ----------
  it("test_log_query_event", () => {
    const logPath = path.join(tmpPath, "audit.jsonl");
    enableAudit(logPath, "sess01");
    logQuery({
      env: "dev",
      query: "SELECT * FROM t",
      status: "ok",
      row_count: 42,
      execution_time_ms: 120,
      error: null,
      context: "unit-test",
    });
    const record = JSON.parse(fs.readFileSync(logPath, "utf-8").trim()) as
      Record<string, unknown>;
    expect(record["event_type"]).toBe("query");
    expect(record["env"]).toBe("dev");
    expect(record["query"]).toBe("SELECT * FROM t");
    expect(record["status"]).toBe("ok");
    expect(record["row_count"]).toBe(42);
    expect(record["execution_time_ms"]).toBe(120);
    expect(record["session_id"]).toBe("sess01");
    expect(record["context"]).toBe("unit-test");
    expect(record).toHaveProperty("timestamp");
  });

  // ---------- 4. query_truncated_2000 ----------
  it("test_query_truncated_2000", () => {
    const logPath = path.join(tmpPath, "audit.jsonl");
    enableAudit(logPath, "trunc");
    const longQuery = "X".repeat(3000);
    logQuery({
      env: "dev",
      query: longQuery,
      status: "ok",
      row_count: 0,
      execution_time_ms: 1,
    });
    const record = JSON.parse(fs.readFileSync(logPath, "utf-8").trim()) as
      Record<string, unknown>;
    expect((record["query"] as string).length).toBe(2000);
  });

  // ---------- 5. session_id_auto ----------
  it("test_session_id_auto", () => {
    const logPath = path.join(tmpPath, "audit.jsonl");
    enableAudit(logPath); // no explicit session_id
    logQuery({
      env: "dev",
      query: "SELECT 1",
      status: "ok",
      row_count: 0,
      execution_time_ms: 1,
    });
    const record = JSON.parse(fs.readFileSync(logPath, "utf-8").trim()) as
      Record<string, unknown>;
    const sid = record["session_id"];
    expect(typeof sid).toBe("string");
    expect((sid as string).length).toBe(12);
    // Must be valid hex — parseInt rejects non-hex.
    expect(/^[0-9a-fA-F]{12}$/.test(sid as string)).toBe(true);
  });

  // ---------- 6. custom_session_id ----------
  it("test_custom_session_id", () => {
    const logPath = path.join(tmpPath, "audit.jsonl");
    enableAudit(logPath, "my-custom-id");
    logQuery({
      env: "dev",
      query: "SELECT 1",
      status: "ok",
      row_count: 0,
      execution_time_ms: 1,
    });
    const record = JSON.parse(fs.readFileSync(logPath, "utf-8").trim()) as
      Record<string, unknown>;
    expect(record["session_id"]).toBe("my-custom-id");
  });

  // ---------- 7. non_failing_write_error ----------
  it("test_non_failing_write_error", () => {
    // Point audit to a path that cannot be written (directory does not exist).
    const badPath = path.join(tmpPath, "no", "such", "dir", "audit.jsonl");
    enableAudit(badPath, "fail-safe");
    // Should NOT raise.
    expect(() =>
      logQuery({
        env: "dev",
        query: "SELECT 1",
        status: "ok",
        row_count: 0,
        execution_time_ms: 1,
      }),
    ).not.toThrow();
  });

  // ---------- 8. log_non_query_event ----------
  it("test_log_non_query_event", () => {
    const logPath = path.join(tmpPath, "audit.jsonl");
    enableAudit(logPath, "evt01");
    logEvent({
      event_type: "schema_inspect",
      details: { table: "users" },
    });
    const record = JSON.parse(fs.readFileSync(logPath, "utf-8").trim()) as
      Record<string, unknown>;
    expect(record["event_type"]).toBe("schema_inspect");
    expect(record["details"]).toEqual({ table: "users" });
    expect(record["session_id"]).toBe("evt01");
    expect(record).toHaveProperty("timestamp");
  });

  // ---------- 9. multiple_append ----------
  it("test_multiple_append", () => {
    const logPath = path.join(tmpPath, "audit.jsonl");
    enableAudit(logPath, "multi");
    logQuery({
      env: "dev",
      query: "Q1",
      status: "ok",
      row_count: 1,
      execution_time_ms: 1,
    });
    logQuery({
      env: "dev",
      query: "Q2",
      status: "ok",
      row_count: 2,
      execution_time_ms: 2,
    });
    logEvent({ event_type: "connect", details: { host: "localhost" } });
    const lines = fs.readFileSync(logPath, "utf-8").trim().split("\n");
    expect(lines.length).toBe(3);
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });

  // ---------- scrubSqlSecrets unit tests ----------
  it("scrubSqlSecrets masks single-quoted credential literals", () => {
    expect(
      scrubSqlSecrets("SELECT * FROM u WHERE password = 'p4ss' AND id = 1"),
    ).toBe("SELECT * FROM u WHERE password='[REDACTED]' AND id = 1");
    expect(scrubSqlSecrets("WHERE token='sk-abc123'")).toBe(
      "WHERE token='[REDACTED]'",
    );
    expect(scrubSqlSecrets("WHERE api_key = 'k1' OR api-key = 'k2'")).toBe(
      "WHERE api_key='[REDACTED]' OR api-key='[REDACTED]'",
    );
  });

  it("scrubSqlSecrets masks double-quoted credential literals", () => {
    expect(scrubSqlSecrets('WHERE secret = "s3cr3t"')).toBe(
      'WHERE secret="[REDACTED]"',
    );
  });

  it("scrubSqlSecrets leaves non-credential literals alone", () => {
    expect(scrubSqlSecrets("SELECT name FROM u WHERE id = 1")).toBe(
      "SELECT name FROM u WHERE id = 1",
    );
    expect(scrubSqlSecrets("WHERE name = 'alice'")).toBe(
      "WHERE name = 'alice'",
    );
  });

  it("logQuery scrubs credentials before persisting to the audit file", () => {
    const logPath = path.join(tmpPath, "audit.jsonl");
    enableAudit(logPath, "abc123");
    logQuery({
      env: "dev",
      query: "SELECT * FROM users WHERE password = 'leaked' LIMIT 1",
      status: "ok",
      row_count: 1,
      execution_time_ms: 5,
    });
    const line = fs.readFileSync(logPath, "utf-8").trim();
    const record = JSON.parse(line) as { query: string };
    expect(record.query).toBe(
      "SELECT * FROM users WHERE password='[REDACTED]' LIMIT 1",
    );
    expect(record.query).not.toContain("leaked");
  });
});
