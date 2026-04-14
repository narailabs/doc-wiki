/**
 * Tests for gcp_query and GcpClient.
 *
 * Child-process execution is mocked via an injected `runner` so no real
 * gcloud/bq binary is required.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetch, VALID_ACTIONS } from "../gcp_query.js";
import {
  GcpClient,
  type GcpClientOptions,
} from "../lib/gcp_client.js";

type RunnerCall = { file: string; args: string[] };

function makeClient(
  stdout: string | ((call: RunnerCall) => string),
  overrides: Partial<GcpClientOptions> = {},
): GcpClient {
  const calls: RunnerCall[] = [];
  const runner = ((file: string, args: string[]) => {
    const call: RunnerCall = { file, args };
    calls.push(call);
    return typeof stdout === "function" ? stdout(call) : stdout;
  }) as GcpClientOptions["runner"];
  const client = new GcpClient({
    rateLimitPerMin: 100,
    connectTimeoutMs: 50,
    readTimeoutMs: 50,
    runner,
    sleepImpl: async () => {},
    ...overrides,
  });
  (client as unknown as { _calls: RunnerCall[] })._calls = calls;
  return client;
}

function callsOf(client: GcpClient): RunnerCall[] {
  return (client as unknown as { _calls: RunnerCall[] })._calls;
}

describe("GcpClient", () => {
  afterEach(() => vi.restoreAllMocks());

  it("rejects invalid project IDs", async () => {
    const client = makeClient("[]");
    const r = await client.listServices("Invalid-PROJECT");
    expect(r).toEqual(
      expect.objectContaining({ ok: false, code: "INVALID_PROJECT" }),
    );
  });

  it("lists services with correct gcloud args", async () => {
    const client = makeClient('[{"name": "run.googleapis.com"}]');
    const r = await client.listServices("acme-prod-123");
    expect(r.ok).toBe(true);
    const call = callsOf(client)[0];
    expect(call?.file).toBe("gcloud");
    expect(call?.args).toEqual([
      "services",
      "list",
      "--project",
      "acme-prod-123",
      "--enabled",
      "--format=json",
    ]);
  });

  it("describes SQL instance", async () => {
    const client = makeClient(
      JSON.stringify({
        name: "main-pg",
        databaseVersion: "POSTGRES_15",
        settings: { tier: "db-n1-standard-1" },
        region: "us-central1",
        state: "RUNNABLE",
      }),
    );
    const r = await client.describeSqlInstance("acme-prod-123", "main-pg");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.databaseVersion).toBe("POSTGRES_15");
  });

  it("blocks semicolons in log filter", async () => {
    const client = makeClient("[]");
    const r = await client.queryLogs("acme-prod-123", "severity=ERROR;rm -rf", 1, 1);
    expect(r).toEqual(
      expect.objectContaining({ ok: false, code: "INVALID_FILTER" }),
    );
  });

  it("bq query rejects non-SELECT SQL", async () => {
    const client = makeClient("[]");
    const r = await client.bqQuery(
      "acme-prod-123",
      "DROP TABLE foo",
      10,
    );
    expect(r).toEqual(
      expect.objectContaining({ ok: false, code: "WRITE_FORBIDDEN" }),
    );
  });

  it("bq query passes SELECT through with read-only flags", async () => {
    const client = makeClient("[]");
    await client.bqQuery("acme-prod-123", "SELECT * FROM t LIMIT 1", 10);
    const call = callsOf(client)[0];
    expect(call?.file).toBe("bq");
    expect(call?.args).toContain("--use_legacy_sql=false");
    expect(call?.args).toContain("--project_id=acme-prod-123");
  });

  it("bq query rejects multi-statement scripts that chain a DROP after SELECT", async () => {
    const client = makeClient("[]");
    const r = await client.bqQuery(
      "acme-prod-123",
      "SELECT 1; DROP TABLE x",
      10,
    );
    expect(r).toEqual(
      expect.objectContaining({ ok: false, code: "WRITE_FORBIDDEN" }),
    );
    expect(callsOf(client).length).toBe(0);
  });

  it("bq query permits a single trailing semicolon", async () => {
    const client = makeClient("[]");
    const r = await client.bqQuery("acme-prod-123", "SELECT 1;", 10);
    expect(r.ok).toBe(true);
  });

  it("bq query permits semicolons inside string literals", async () => {
    const client = makeClient("[]");
    const r = await client.bqQuery(
      "acme-prod-123",
      "SELECT 'a;b' AS v",
      10,
    );
    expect(r.ok).toBe(true);
  });
});

describe("gcp_query.fetch", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("VALID_ACTIONS set", () => {
    expect([...VALID_ACTIONS].sort()).toEqual([
      "describe_db",
      "list_services",
      "list_topics",
      "query_logs",
    ]);
  });

  it("validates project_id format", async () => {
    const r = await fetch("list_services", { project_id: "BAD" });
    expect(r["error_code"]).toBe("VALIDATION_ERROR");
  });

  it("uses injected client and shapes services response", async () => {
    const client = makeClient(
      '[{"name": "run.googleapis.com", "config": {"title": "Cloud Run"}, "state": "ENABLED"}]',
    );
    const r = await fetch(
      "list_services",
      { project_id: "acme-prod-123" },
      { client },
    );
    expect(r["status"]).toBe("success");
    const data = r["data"] as Record<string, unknown>;
    expect(data["service_count"]).toBe(1);
  });

  it("describe_db splits engine/version from databaseVersion", async () => {
    const client = makeClient(
      JSON.stringify({
        databaseVersion: "MYSQL_8_0",
        settings: { tier: "db-n1-standard-2" },
        region: "us-central1",
        state: "RUNNABLE",
      }),
    );
    const r = await fetch(
      "describe_db",
      {
        project_id: "acme-prod-123",
        instance_id: "main-db",
        database: "primary",
      },
      { client },
    );
    const data = r["data"] as Record<string, unknown>;
    expect(data["engine"]).toBe("mysql");
    expect(data["version"]).toBe("8");
  });
});

describe("gcp_query mermaid field (G1)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("list_services emits graph TB with project + service nodes", async () => {
    const client = makeClient(
      '[{"name": "run.googleapis.com", "config": {"title": "Cloud Run"}, "state": "ENABLED"},' +
        ' {"name": "pubsub.googleapis.com", "config": {"title": "Pub/Sub"}, "state": "ENABLED"}]',
    );
    const r = await fetch(
      "list_services",
      { project_id: "acme-prod-123" },
      { client },
    );
    const m = r["mermaid"] as { type: string; code: string; title: string } | undefined;
    expect(m).toBeDefined();
    expect(m!.type).toBe("graph TB");
    expect(m!.code).toContain("Cloud Run");
    expect(m!.title).toContain("acme-prod-123");
  });

  it("list_services omits mermaid when empty", async () => {
    const client = makeClient("[]");
    const r = await fetch("list_services", { project_id: "acme-prod-123" }, { client });
    expect(r["status"]).toBe("success");
    expect(r["mermaid"]).toBeUndefined();
  });

  it("describe_db emits graph TB with project + db node", async () => {
    const client = makeClient(
      JSON.stringify({
        databaseVersion: "POSTGRES_15",
        settings: { tier: "db-n1-standard-1" },
        region: "us-central1",
        state: "RUNNABLE",
      }),
    );
    const r = await fetch(
      "describe_db",
      { project_id: "acme-prod-123", instance_id: "main-db", database: "primary" },
      { client },
    );
    const m = r["mermaid"] as { type: string; code: string } | undefined;
    expect(m).toBeDefined();
    expect(m!.type).toBe("graph TB");
    expect(m!.code).toContain("main-db");
    expect(m!.code).toContain("postgres");
  });

  it("list_topics emits graph TB when topics exist", async () => {
    const client = makeClient(
      '[{"name": "projects/acme-prod-123/topics/events"},' +
        ' {"name": "projects/acme-prod-123/topics/alerts"}]',
    );
    const r = await fetch("list_topics", { project_id: "acme-prod-123" }, { client });
    const m = r["mermaid"] as { code: string } | undefined;
    expect(m).toBeDefined();
    expect(m!.code).toContain("events");
    expect(m!.code).toContain("alerts");
  });

  it("query_logs never emits mermaid (not diagram-worthy)", async () => {
    const client = makeClient(
      '[{"timestamp": "2026-04-01T00:00:00Z", "severity": "INFO", "textPayload": "hello"}]',
    );
    const r = await fetch(
      "query_logs",
      { project_id: "acme-prod-123", filter: "severity>=INFO" },
      { client },
    );
    // query_logs return shape is time-series — diagram omitted regardless
    // of whether the stub stdout happens to match the client's expected
    // JSON shape exactly.
    expect(r["mermaid"]).toBeUndefined();
  });
});
