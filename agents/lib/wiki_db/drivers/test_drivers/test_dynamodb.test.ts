/**
 * Unit tests for DynamoDriver — pure mocks, no DynamoDB Local required.
 *
 * Live integration in sibling `live_dynamodb.test.ts`, gated by
 * TEST_LIVE_DYNAMO.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class FakeCommand {
    public readonly name: string;
    public readonly input: unknown;
    constructor(name: string, input: unknown) {
      this.name = name;
      this.input = input;
    }
  }
  class MockClient {
    public readonly config: Record<string, unknown>;
    public readonly sendSpy: ReturnType<typeof vi.fn>;
    public readonly destroySpy: ReturnType<typeof vi.fn>;
    constructor(config: Record<string, unknown>) {
      this.config = config;
      this.sendSpy = vi.fn(async (_cmd: FakeCommand) => ({}));
      this.destroySpy = vi.fn();
    }
    send(cmd: FakeCommand): Promise<unknown> {
      return this.sendSpy(cmd);
    }
    destroy(): void {
      this.destroySpy();
    }
  }
  const clients: MockClient[] = [];
  return { FakeCommand, MockClient, clients };
});

vi.mock("@aws-sdk/client-dynamodb", () => ({
  DynamoDBClient: class {
    constructor(config: Record<string, unknown>) {
      const c = new mocks.MockClient(config);
      mocks.clients.push(c);
      return c as unknown;
    }
  },
  ListTablesCommand: class extends mocks.FakeCommand {
    constructor(input: Record<string, unknown>) {
      super("ListTables", input);
    }
  },
  DescribeTableCommand: class extends mocks.FakeCommand {
    constructor(input: { TableName: string }) {
      super("DescribeTable", input);
    }
  },
  GetItemCommand: class extends mocks.FakeCommand {
    constructor(input: { TableName: string; Key: Record<string, unknown> }) {
      super("GetItem", input);
    }
  },
  QueryCommand: class extends mocks.FakeCommand {
    constructor(input: Record<string, unknown>) {
      super("Query", input);
    }
  },
  ScanCommand: class extends mocks.FakeCommand {
    constructor(input: Record<string, unknown>) {
      super("Scan", input);
    }
  },
}));

import { DynamoDriver } from "../dynamodb.js";

function latest(): InstanceType<typeof mocks.MockClient> {
  const c = mocks.clients[mocks.clients.length - 1];
  if (!c) throw new Error("no client yet");
  return c;
}

describe("wiki_db.drivers.dynamodb (unit)", () => {
  beforeEach(() => {
    mocks.clients.length = 0;
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("connect builds a client with the configured region and endpoint", async () => {
    const drv = new DynamoDriver();
    await drv.connect({
      region: "eu-west-1",
      endpoint: "http://localhost:8000",
    });
    const c = latest();
    expect(c.config["region"]).toBe("eu-west-1");
    expect(c.config["endpoint"]).toBe("http://localhost:8000");
  });

  it("connect() reuses the same client across calls", async () => {
    const drv = new DynamoDriver();
    await drv.connect({ region: "us-east-1" });
    await drv.connect({ region: "us-east-1" });
    await drv.connect({ region: "us-east-1" });
    expect(mocks.clients).toHaveLength(1);
  });

  it("sync executeRead returns SYNC_UNSUPPORTED", () => {
    const drv = new DynamoDriver();
    const r = drv.executeRead(null as unknown, "{}");
    expect(r.status).toBe("error");
    expect(r.error_code).toBe("SYNC_UNSUPPORTED");
  });

  it("rejects malformed envelopes", async () => {
    const drv = new DynamoDriver();
    const handle = await drv.connect({ region: "us-east-1" });
    const r = await drv.executeReadAsync(handle, "junk");
    expect(r.status).toBe("error");
    expect(r.error).toMatch(/JSON envelope/);
  });

  it("rejects non-read ops (no PutItem/UpdateItem/DeleteItem)", async () => {
    const drv = new DynamoDriver();
    const handle = await drv.connect({ region: "us-east-1" });
    const r = await drv.executeReadAsync(
      handle,
      JSON.stringify({ table: "t", op: "putItem" }),
    );
    expect(r.status).toBe("error");
    expect(r.error).toMatch(/forbidden op/);
  });

  it("get: issues GetItemCommand and unmarshals the item", async () => {
    const drv = new DynamoDriver();
    const handle = await drv.connect({ region: "us-east-1" });
    const client = latest();
    client.sendSpy.mockImplementation(
      async (cmd: InstanceType<typeof mocks.FakeCommand>) => {
        if (cmd.name === "GetItem") {
          return {
            Item: {
              id: { S: "abc" },
              age: { N: "42" },
              verified: { BOOL: true },
            },
          };
        }
        return {};
      },
    );

    const r = await drv.executeReadAsync(
      handle,
      JSON.stringify({
        table: "users",
        op: "get",
        key: { id: { S: "abc" } },
      }),
    );
    expect(r.status).toBe("success");
    expect(r.rows).toEqual([{ id: "abc", age: 42, verified: true }]);

    const cmd = client.sendSpy.mock.calls[0]![0] as InstanceType<
      typeof mocks.FakeCommand
    >;
    expect(cmd.name).toBe("GetItem");
  });

  it("sample: uses ScanCommand with a 10-item limit", async () => {
    const drv = new DynamoDriver();
    const handle = await drv.connect({ region: "us-east-1" });
    const client = latest();
    client.sendSpy.mockImplementation(async () => ({
      Items: [{ id: { S: "x" } }],
    }));
    const r = await drv.executeReadAsync(
      handle,
      JSON.stringify({ table: "logs", op: "sample" }),
    );
    expect(r.status).toBe("success");
    const cmd = client.sendSpy.mock.calls[0]![0] as InstanceType<
      typeof mocks.FakeCommand
    >;
    expect(cmd.name).toBe("Scan");
    expect((cmd.input as { Limit: number }).Limit).toBe(10);
  });

  it("scan: enforces truncation at maxRows", async () => {
    const drv = new DynamoDriver();
    const handle = await drv.connect({ region: "us-east-1" });
    const client = latest();
    client.sendSpy.mockImplementation(async () => ({
      Items: [{ a: { N: "1" } }, { a: { N: "2" } }, { a: { N: "3" } }],
    }));
    const r = await drv.executeReadAsync(
      handle,
      JSON.stringify({ table: "nums", op: "scan" }),
      null,
      2,
    );
    expect(r.status).toBe("success");
    expect(r.row_count).toBe(2);
    expect(r.truncated).toBe(true);
  });

  it("query: requires a keyCondition and forwards ExpressionAttributeValues", async () => {
    const drv = new DynamoDriver();
    const handle = await drv.connect({ region: "us-east-1" });

    const bad = await drv.executeReadAsync(
      handle,
      JSON.stringify({ table: "t", op: "query" }),
    );
    expect(bad.status).toBe("error");

    const client = latest();
    client.sendSpy.mockImplementation(async () => ({ Items: [] }));
    const good = await drv.executeReadAsync(
      handle,
      JSON.stringify({
        table: "t",
        op: "query",
        keyCondition: {
          KeyConditionExpression: "pk = :p",
          ExpressionAttributeValues: { ":p": { S: "x" } },
        },
      }),
    );
    expect(good.status).toBe("success");
    const cmd = client.sendSpy.mock.calls[0]![0] as InstanceType<
      typeof mocks.FakeCommand
    >;
    expect(cmd.name).toBe("Query");
    const input = cmd.input as Record<string, unknown>;
    expect(input["KeyConditionExpression"]).toBe("pk = :p");
  });

  it("getSchemaAsync combines ListTables + DescribeTable", async () => {
    const drv = new DynamoDriver();
    const handle = await drv.connect({ region: "us-east-1" });
    const client = latest();
    client.sendSpy.mockImplementation(
      async (cmd: InstanceType<typeof mocks.FakeCommand>) => {
        if (cmd.name === "ListTables") {
          return { TableNames: ["users", "orders"] };
        }
        if (cmd.name === "DescribeTable") {
          const name = (cmd.input as { TableName: string }).TableName;
          return {
            Table: {
              TableName: name,
              KeySchema: [{ AttributeName: "pk", KeyType: "HASH" }],
              AttributeDefinitions: [
                { AttributeName: "pk", AttributeType: "S" },
                { AttributeName: "sk", AttributeType: "N" },
              ],
            },
          };
        }
        return {};
      },
    );

    const tables = await drv.getSchemaAsync(handle);
    expect(tables.map((t) => t.name).sort()).toEqual(["orders", "users"]);
    const users = tables.find((t) => t.name === "users")!;
    const colMap = new Map(users.columns.map((c) => [c.name, c]));
    expect(colMap.get("pk")!.is_primary_key).toBe(true);
    expect(colMap.get("pk")!.data_type).toBe("string");
    expect(colMap.get("sk")!.data_type).toBe("number");
    expect(colMap.get("sk")!.is_primary_key).toBe(false);
  });

  it("close() is a no-op; client stays live for other handles", async () => {
    const drv = new DynamoDriver();
    const handle = await drv.connect({ region: "us-east-1" });
    const client = latest();
    await drv.closeAsync(handle);
    expect(client.destroySpy).not.toHaveBeenCalled();
  });

  it("healthCheck runs ListTables(Limit=1) and returns true on success", async () => {
    const drv = new DynamoDriver();
    const handle = await drv.connect({ region: "us-east-1" });
    const client = latest();
    client.sendSpy.mockImplementation(async () => ({ TableNames: [] }));
    expect(await drv.healthCheck(handle)).toBe(true);
    const cmd = client.sendSpy.mock.calls[0]![0] as InstanceType<
      typeof mocks.FakeCommand
    >;
    expect(cmd.name).toBe("ListTables");
    expect((cmd.input as { Limit?: number }).Limit).toBe(1);
  });

  it("healthCheck returns false when ListTables throws", async () => {
    const drv = new DynamoDriver();
    const handle = await drv.connect({ region: "us-east-1" });
    latest().sendSpy.mockImplementation(async () => {
      throw new Error("auth failed");
    });
    expect(await drv.healthCheck(handle)).toBe(false);
  });

  it("shutdown destroys the SDK client exactly once", async () => {
    const drv = new DynamoDriver();
    await drv.connect({ region: "us-east-1" });
    const client = latest();
    await drv.shutdown();
    expect(client.destroySpy).toHaveBeenCalledTimes(1);
    await drv.shutdown();
    expect(client.destroySpy).toHaveBeenCalledTimes(1);
  });
});
