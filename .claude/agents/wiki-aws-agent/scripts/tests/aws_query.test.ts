/**
 * Tests for aws_query and AwsClient.
 *
 * SDK clients are dependency-injected as mock `{ send }` objects, so no
 * real `@aws-sdk/client-*` package is required.
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { fetch, VALID_ACTIONS } from "../aws_query.js";
import {
  AwsClient,
  type AwsClientOptions,
  type AwsSdkFactories,
} from "../lib/aws_client.js";

type SendHandler = (cmd: Record<string, unknown>) => Promise<unknown>;

function makeFactories(
  handlers: Partial<Record<keyof AwsSdkFactories, SendHandler>>,
): AwsSdkFactories {
  const factories: AwsSdkFactories = {};
  for (const [key, handler] of Object.entries(handlers) as Array<
    [keyof AwsSdkFactories, SendHandler]
  >) {
    factories[key] = () => ({
      send: async (cmd) => handler(cmd as Record<string, unknown>),
    });
  }
  return factories;
}

function makeClient(
  factories: AwsSdkFactories,
  overrides: Partial<AwsClientOptions> = {},
): AwsClient {
  return new AwsClient({
    region: "us-east-1",
    factories,
    rateLimitPerMin: 100,
    connectTimeoutMs: 50,
    readTimeoutMs: 50,
    sleepImpl: async () => {},
    ...overrides,
  });
}

describe("AwsClient", () => {
  afterEach(() => vi.restoreAllMocks());

  it("whitelists command names and rejects others", async () => {
    const client = makeClient(
      makeFactories({
        rds: async () => ({ DBInstances: [] }),
      }),
    );
    const r = await client.send("rds", {
      name: "DeleteDBInstanceCommand",
      input: {},
    });
    expect(r).toEqual(
      expect.objectContaining({ ok: false, code: "METHOD_NOT_ALLOWED" }),
    );
  });

  it("returns SDK_UNAVAILABLE when factory missing", async () => {
    const client = makeClient({});
    const r = await client.listTables();
    expect(r).toEqual(
      expect.objectContaining({ ok: false, code: "SDK_UNAVAILABLE" }),
    );
  });

  it("describes RDS instance through injected factory", async () => {
    let sent: Record<string, unknown> | null = null;
    const client = makeClient(
      makeFactories({
        rds: async (cmd) => {
          sent = cmd;
          return {
            DBInstances: [
              {
                DBInstanceIdentifier: "acme-rds",
                Engine: "postgres",
                EngineVersion: "15.3",
                DBInstanceClass: "db.t3.medium",
                DBInstanceStatus: "available",
                Endpoint: { Address: "acme-rds.us-east-1.rds" },
                AllocatedStorage: 100,
              },
            ],
          };
        },
      }),
    );
    const r = await client.describeDBInstances({
      DBInstanceIdentifier: "acme-rds",
    });
    expect(sent?.["__name__"]).toBe("DescribeDBInstancesCommand");
    expect(sent?.["DBInstanceIdentifier"]).toBe("acme-rds");
    expect(r.ok).toBe(true);
  });

  it("times out if the SDK call hangs", async () => {
    const client = makeClient(
      makeFactories({
        dynamodb: () =>
          new Promise<Record<string, unknown>>(() => {
            /* never resolves */
          }),
      }),
      { connectTimeoutMs: 5, readTimeoutMs: 5 },
    );
    const r = await client.listTables();
    expect(r).toEqual(
      expect.objectContaining({ ok: false, code: "TIMEOUT" }),
    );
  });
});

describe("aws_query.fetch", () => {
  it("VALID_ACTIONS set", () => {
    expect([...VALID_ACTIONS].sort()).toEqual([
      "describe_db",
      "get_metrics",
      "list_buckets",
      "list_functions",
    ]);
  });

  it("rejects invalid region", async () => {
    const r = await fetch("list_functions", { region: "Bad-Region" });
    expect(r["error_code"]).toBe("VALIDATION_ERROR");
  });

  it("describes db via injected client", async () => {
    const client = makeClient(
      makeFactories({
        rds: async () => ({
          DBInstances: [
            {
              DBInstanceIdentifier: "acme-rds",
              Engine: "mysql",
              EngineVersion: "8.0",
              DBInstanceClass: "db.t3.micro",
              DBInstanceStatus: "available",
              Endpoint: { Address: "acme.rds.local" },
              AllocatedStorage: 20,
            },
          ],
        }),
      }),
    );
    const r = await fetch(
      "describe_db",
      { region: "us-east-1", db_identifier: "acme-rds" },
      { client },
    );
    expect(r["status"]).toBe("success");
    const data = r["data"] as Record<string, unknown>;
    expect(data["engine"]).toBe("mysql");
    expect(data["endpoint"]).toBe("acme.rds.local");
  });

  it("list_buckets filters by prefix", async () => {
    const client = makeClient(
      makeFactories({
        s3: async () => ({
          Buckets: [
            { Name: "acme-logs", CreationDate: new Date("2026-01-01") },
            { Name: "other", CreationDate: new Date("2026-01-02") },
          ],
        }),
      }),
    );
    const r = await fetch(
      "list_buckets",
      { prefix: "acme-" },
      { client },
    );
    const data = r["data"] as Record<string, unknown>;
    expect(data["bucket_count"]).toBe(1);
  });

  it("returns NOT_FOUND when DBInstances is empty", async () => {
    const client = makeClient(
      makeFactories({ rds: async () => ({ DBInstances: [] }) }),
    );
    const r = await fetch(
      "describe_db",
      { region: "us-east-1", db_identifier: "missing" },
      { client },
    );
    expect(r["error_code"]).toBe("NOT_FOUND");
  });
});

describe("aws_query mermaid field (G1)", () => {
  it("list_functions emits graph TB with region + function nodes", async () => {
    const client = makeClient(
      makeFactories({
        lambda: async () => ({
          Functions: [
            { FunctionName: "hello", Runtime: "nodejs20.x", LastModified: "2026-04-01" },
            { FunctionName: "world", Runtime: "python3.12", LastModified: "2026-04-02" },
          ],
        }),
      }),
    );
    const r = await fetch("list_functions", { region: "us-east-1" }, { client });
    const m = r["mermaid"] as { type: string; title: string; code: string } | undefined;
    expect(m).toBeDefined();
    expect(m!.type).toBe("graph TB");
    expect(m!.code).toContain("graph TB");
    expect(m!.code).toContain("hello");
    expect(m!.code).toContain("world");
    expect(m!.title).toContain("us-east-1");
  });

  it("describe_db emits graph TB with region + db node", async () => {
    const client = makeClient(
      makeFactories({
        rds: async () => ({
          DBInstances: [
            {
              DBInstanceIdentifier: "acme-rds",
              Engine: "postgres",
              EngineVersion: "15.3",
              DBInstanceClass: "db.t3.medium",
              DBInstanceStatus: "available",
              Endpoint: { Address: "acme.rds" },
              AllocatedStorage: 100,
            },
          ],
        }),
      }),
    );
    const r = await fetch(
      "describe_db",
      { region: "us-east-1", db_identifier: "acme-rds" },
      { client },
    );
    const m = r["mermaid"] as { type: string; code: string } | undefined;
    expect(m).toBeDefined();
    expect(m!.type).toBe("graph TB");
    expect(m!.code).toContain("acme-rds");
    expect(m!.code).toContain("postgres");
  });

  it("list_buckets emits graph TB when buckets are present", async () => {
    const client = makeClient(
      makeFactories({
        s3: async () => ({
          Buckets: [
            { Name: "acme-logs", CreationDate: new Date("2026-01-01") },
            { Name: "acme-data", CreationDate: new Date("2026-01-02") },
          ],
        }),
      }),
    );
    const r = await fetch("list_buckets", {}, { client });
    const m = r["mermaid"] as { code: string } | undefined;
    expect(m).toBeDefined();
    expect(m!.code).toContain("acme-logs");
    expect(m!.code).toContain("acme-data");
  });

  it("list_buckets omits mermaid when empty", async () => {
    const client = makeClient(
      makeFactories({ s3: async () => ({ Buckets: [] }) }),
    );
    const r = await fetch("list_buckets", {}, { client });
    expect(r["mermaid"]).toBeUndefined();
  });

  it("get_metrics never emits mermaid (not diagram-worthy)", async () => {
    const client = makeClient(
      makeFactories({
        cloudwatch: async () => ({
          Datapoints: [{ Timestamp: new Date(), Sum: 1, Average: 1, Maximum: 1 }],
        }),
      }),
    );
    const r = await fetch(
      "get_metrics",
      {
        region: "us-east-1",
        namespace: "AWS/Lambda",
        metric_name: "Errors",
        dimensions: { FunctionName: "hello" },
      },
      { client },
    );
    expect(r["status"]).toBe("success");
    expect(r["mermaid"]).toBeUndefined();
  });
});
