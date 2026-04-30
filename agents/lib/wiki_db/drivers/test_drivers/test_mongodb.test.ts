/**
 * Unit tests for MongoDriver — pure mocks, no MongoDB container required.
 *
 * Live integration in sibling `live_mongodb.test.ts`, gated by TEST_LIVE_MONGO.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  type MockCursor = {
    toArray: ReturnType<typeof vi.fn>;
    limit: ReturnType<typeof vi.fn>;
    project: ReturnType<typeof vi.fn>;
    sort: ReturnType<typeof vi.fn>;
  };
  function makeCursor(items: Record<string, unknown>[]): MockCursor {
    const c: MockCursor = {
      toArray: vi.fn(async () => items),
      limit: vi.fn(function (this: MockCursor) {
        return c;
      }),
      project: vi.fn(function (this: MockCursor) {
        return c;
      }),
      sort: vi.fn(function (this: MockCursor) {
        return c;
      }),
    };
    return c;
  }
  class MockCollection {
    public readonly find: ReturnType<typeof vi.fn>;
    public readonly aggregate: ReturnType<typeof vi.fn>;
    public readonly countDocuments: ReturnType<typeof vi.fn>;
    constructor() {
      this.find = vi.fn(() => makeCursor([]));
      this.aggregate = vi.fn(() => makeCursor([]));
      this.countDocuments = vi.fn(async () => 0);
    }
  }
  class MockDb {
    public readonly collections: Map<string, MockCollection>;
    public readonly commandSpy: ReturnType<typeof vi.fn>;
    constructor() {
      this.collections = new Map();
      this.commandSpy = vi.fn(async () => ({ ok: 1 }));
    }
    collection(name: string): MockCollection {
      let c = this.collections.get(name);
      if (!c) {
        c = new MockCollection();
        this.collections.set(name, c);
      }
      return c;
    }
    command(cmd: Record<string, unknown>): Promise<Record<string, unknown>> {
      return this.commandSpy(cmd);
    }
    listCollections() {
      return {
        toArray: async () =>
          [...this.collections.keys()].map((n) => ({ name: n })),
      };
    }
  }
  class MockClient {
    public readonly uri: string;
    public readonly options: Record<string, unknown>;
    public readonly _db: MockDb;
    public readonly connectSpy: ReturnType<typeof vi.fn>;
    public readonly closeSpy: ReturnType<typeof vi.fn>;
    constructor(uri: string, options: Record<string, unknown>) {
      this.uri = uri;
      this.options = options;
      this._db = new MockDb();
      this.connectSpy = vi.fn();
      this.closeSpy = vi.fn(() => Promise.resolve());
    }
    async connect(): Promise<this> {
      this.connectSpy();
      return this;
    }
    close(): Promise<void> {
      return this.closeSpy();
    }
    db(): MockDb {
      return this._db;
    }
  }
  const clients: MockClient[] = [];
  return { MockClient, clients, makeCursor };
});

vi.mock("mongodb", () => ({
  MongoClient: class {
    constructor(uri: string, options: Record<string, unknown>) {
      const c = new mocks.MockClient(uri, options);
      mocks.clients.push(c);
      return c as unknown;
    }
  },
}));

import { MongoDriver } from "../mongodb.js";

function latest(): InstanceType<typeof mocks.MockClient> {
  const c = mocks.clients[mocks.clients.length - 1];
  if (!c) throw new Error("no client yet");
  return c;
}

describe("wiki_db.drivers.mongodb (unit)", () => {
  beforeEach(() => {
    mocks.clients.length = 0;
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("connect builds a URI when one is not supplied", async () => {
    const drv = new MongoDriver();
    await drv.connect({
      host: "mongo.example.com",
      port: 27017,
      user: "u",
      password: "p",
      database: "app",
    });
    const c = latest();
    expect(c.uri).toBe("mongodb://u:p@mongo.example.com:27017");
    expect(c.connectSpy).toHaveBeenCalled();
  });

  it("connect() reuses the same client across calls", async () => {
    const drv = new MongoDriver();
    await drv.connect({ database: "app" });
    await drv.connect({ database: "app" });
    await drv.connect({ database: "app" });
    expect(mocks.clients).toHaveLength(1);
    expect(latest().connectSpy).toHaveBeenCalledTimes(1);
  });

  it("connect uses an explicit URI when provided", async () => {
    const drv = new MongoDriver();
    await drv.connect({
      uri: "mongodb+srv://a:b@cluster/test",
      database: "app",
    });
    expect(latest().uri).toBe("mongodb+srv://a:b@cluster/test");
  });

  it("sync executeRead returns SYNC_UNSUPPORTED", () => {
    const drv = new MongoDriver();
    const r = drv.executeRead(null as unknown, "{}");
    expect(r.status).toBe("error");
    expect(r.error_code).toBe("SYNC_UNSUPPORTED");
  });

  it("rejects malformed JSON envelopes", async () => {
    const drv = new MongoDriver();
    const handle = await drv.connect({ database: "app" });
    const r = await drv.executeReadAsync(handle, "not json");
    expect(r.status).toBe("error");
    expect(r.error).toMatch(/JSON envelope/);
  });

  it("rejects non-read ops at the driver layer", async () => {
    const drv = new MongoDriver();
    const handle = await drv.connect({ database: "app" });
    const r = await drv.executeReadAsync(
      handle,
      JSON.stringify({ collection: "users", op: "insertOne", filter: {} }),
    );
    expect(r.status).toBe("error");
    expect(r.error).toMatch(/forbidden op/);
  });

  it("find returns documents with truncation and inferred columns", async () => {
    const drv = new MongoDriver();
    const handle = await drv.connect({ database: "app" });
    const db = latest()._db;
    const coll = db.collection("users");
    coll.find.mockReturnValue(
      mocks.makeCursor([
        { _id: "1", name: "a" },
        { _id: "2", name: "b" },
        { _id: "3", name: "c" },
      ]),
    );

    const r = await drv.executeReadAsync(
      handle,
      JSON.stringify({ collection: "users", op: "find", filter: {} }),
      null,
      2,
    );
    expect(r.status).toBe("success");
    expect(r.row_count).toBe(2);
    expect(r.truncated).toBe(true);
    expect(r.columns!.sort()).toEqual(["_id", "name"]);
  });

  it("count returns the document count as a single row", async () => {
    const drv = new MongoDriver();
    const handle = await drv.connect({ database: "app" });
    const coll = latest()._db.collection("users");
    coll.countDocuments.mockResolvedValue(42);

    const r = await drv.executeReadAsync(
      handle,
      JSON.stringify({ collection: "users", op: "count", filter: {} }),
    );
    expect(r.status).toBe("success");
    expect(r.rows).toEqual([{ count: 42 }]);
  });

  it("aggregate appends a $limit stage and returns documents", async () => {
    const drv = new MongoDriver();
    const handle = await drv.connect({ database: "app" });
    const coll = latest()._db.collection("orders");
    coll.aggregate.mockReturnValue(
      mocks.makeCursor([{ _id: "x", total: 10 }]),
    );

    const r = await drv.executeReadAsync(
      handle,
      JSON.stringify({
        collection: "orders",
        op: "aggregate",
        pipeline: [{ $match: {} }],
      }),
    );
    expect(r.status).toBe("success");
    expect(r.row_count).toBe(1);
    const pipeline = coll.aggregate.mock.calls[0]![0] as Record<
      string,
      unknown
    >[];
    expect(pipeline[pipeline.length - 1]).toHaveProperty("$limit");
  });

  it("getSchemaAsync infers columns from sample documents", async () => {
    const drv = new MongoDriver();
    const handle = await drv.connect({ database: "app" });
    const db = latest()._db;
    db.collection("users");
    db.collection("items");
    const usersCursor = mocks.makeCursor([
      { _id: "1", name: "a", age: 30 },
      { _id: "2", name: "b", age: null },
    ]);
    db.collection("users").find.mockReturnValue(usersCursor);
    db.collection("items").find.mockReturnValue(
      mocks.makeCursor([{ _id: "x", price: 9.99 }]),
    );

    const tables = await drv.getSchemaAsync(handle);
    const names = tables.map((t) => t.name).sort();
    expect(names).toEqual(["items", "users"]);

    const users = tables.find((t) => t.name === "users")!;
    const colNames = users.columns.map((c) => c.name).sort();
    expect(colNames).toEqual(["_id", "age", "name"]);
    expect(users.columns.find((c) => c.name === "_id")!.is_primary_key).toBe(
      true,
    );
  });

  it("close() is a no-op; client stays open for other handles", async () => {
    const drv = new MongoDriver();
    const handle = await drv.connect({ database: "app" });
    const c = latest();
    await drv.closeAsync(handle);
    expect(c.closeSpy).not.toHaveBeenCalled();
  });

  it("healthCheck issues a ping command and returns true on ok=1", async () => {
    const drv = new MongoDriver();
    const handle = await drv.connect({ database: "app" });
    const db = latest()._db;
    db.commandSpy.mockResolvedValue({ ok: 1 });
    expect(await drv.healthCheck(handle)).toBe(true);
    expect(db.commandSpy).toHaveBeenCalledWith({ ping: 1 });
  });

  it("healthCheck returns false when ping fails", async () => {
    const drv = new MongoDriver();
    const handle = await drv.connect({ database: "app" });
    latest()._db.commandSpy.mockRejectedValue(new Error("no connection"));
    expect(await drv.healthCheck(handle)).toBe(false);
  });

  it("shutdown closes the underlying client exactly once", async () => {
    const drv = new MongoDriver();
    await drv.connect({ database: "app" });
    const c = latest();
    await drv.shutdown();
    expect(c.closeSpy).toHaveBeenCalledTimes(1);
    await drv.shutdown();
    expect(c.closeSpy).toHaveBeenCalledTimes(1);
  });
});
