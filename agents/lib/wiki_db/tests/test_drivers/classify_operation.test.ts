/**
 * Tests for `DatabaseDriver.classifyOperation` (G-DB-1).
 *
 * Verifies that:
 *  - Relational drivers (sqlite, postgres, mysql, sqlserver) delegate to
 *    `classifySqlKeywords` and produce the same answers as the SQL path.
 *  - The MongoDB driver classifies envelope and dot-notation queries by
 *    verb (find → READ, insertOne → DML, dropCollection → DDL).
 *  - The DynamoDB driver classifies envelope and AWS-SDK command names
 *    (scan → READ, ScanCommand → READ, PutItem → DML, CreateTable → DDL).
 *  - Unknown verbs default to DDL (default-deny).
 *  - Empty input throws.
 */
import { describe, expect, it } from "vitest";

import { OperationType } from "../../policy.js";
import { SQLiteDriver } from "../../drivers/sqlite.js";
import { PostgresDriver } from "../../drivers/postgresql.js";
import { MysqlDriver } from "../../drivers/mysql.js";
import { SqlServerDriver } from "../../drivers/sqlserver.js";
import { MongoDriver } from "../../drivers/mongodb.js";
import {
  DynamoDriver,
  DynamoEnvelopeParseError,
} from "../../drivers/dynamodb.js";

describe("DatabaseDriver.classifyOperation — G-DB-1", () => {
  describe("relational drivers (delegate to SQL keyword classifier)", () => {
    const drivers: [string, { new (): { classifyOperation(q: string): string } }][] = [
      ["sqlite", SQLiteDriver],
      ["postgres", PostgresDriver],
      ["mysql", MysqlDriver],
      ["sqlserver", SqlServerDriver],
    ];

    for (const [name, Ctor] of drivers) {
      describe(name, () => {
        const d = new Ctor();
        it("SELECT classifies as READ", () => {
          expect(d.classifyOperation("SELECT 1")).toBe(OperationType.READ);
        });
        it("INSERT classifies as DML", () => {
          expect(d.classifyOperation("INSERT INTO t (a) VALUES (1)")).toBe(
            OperationType.DML,
          );
        });
        it("DROP classifies as DDL", () => {
          expect(d.classifyOperation("DROP TABLE users")).toBe(OperationType.DDL);
        });
        it("GRANT classifies as PRIVILEGE", () => {
          expect(d.classifyOperation("GRANT SELECT ON t TO u")).toBe(
            OperationType.PRIVILEGE,
          );
        });
        it("empty input throws", () => {
          expect(() => d.classifyOperation("   ")).toThrow(/Empty SQL statement/);
        });
        it("unknown first-word defaults to DDL", () => {
          expect(d.classifyOperation("VACUUM users")).toBe(OperationType.DDL);
        });
      });
    }
  });

  describe("MongoDriver — envelope form", () => {
    const d = new MongoDriver();
    it("find → READ", () => {
      expect(
        d.classifyOperation(JSON.stringify({ collection: "users", op: "find" })),
      ).toBe(OperationType.READ);
    });
    it("insertOne → DML", () => {
      expect(
        d.classifyOperation(
          JSON.stringify({ collection: "users", op: "insertOne" }),
        ),
      ).toBe(OperationType.DML);
    });
    it("dropCollection → DDL", () => {
      expect(
        d.classifyOperation(
          JSON.stringify({ collection: "users", op: "dropCollection" }),
        ),
      ).toBe(OperationType.DDL);
    });
    it("createIndex → DDL", () => {
      expect(
        d.classifyOperation(
          JSON.stringify({ collection: "users", op: "createIndex" }),
        ),
      ).toBe(OperationType.DDL);
    });
    it("unknown op → DDL", () => {
      expect(
        d.classifyOperation(
          JSON.stringify({ collection: "users", op: "doSomethingNew" }),
        ),
      ).toBe(OperationType.DDL);
    });
  });

  describe("MongoDriver — dot-notation form", () => {
    const d = new MongoDriver();
    it("db.users.find({}) → READ", () => {
      expect(d.classifyOperation("db.users.find({})")).toBe(OperationType.READ);
    });
    it("db.users.insertOne({...}) → DML", () => {
      expect(d.classifyOperation('db.users.insertOne({"name": "x"})')).toBe(
        OperationType.DML,
      );
    });
    it("db.users.deleteMany({}) → DML", () => {
      expect(d.classifyOperation("db.users.deleteMany({})")).toBe(
        OperationType.DML,
      );
    });
    it("db.users.createIndex({a: 1}) → DDL", () => {
      expect(d.classifyOperation("db.users.createIndex({a: 1})")).toBe(
        OperationType.DDL,
      );
    });
    it("empty input throws", () => {
      expect(() => d.classifyOperation("  ")).toThrow(/Empty MongoDB statement/);
    });
  });

  describe("DynamoDriver — envelope form", () => {
    const d = new DynamoDriver();
    it("scan → READ", () => {
      expect(
        d.classifyOperation(JSON.stringify({ table: "users", op: "scan" })),
      ).toBe(OperationType.READ);
    });
    it("get → READ", () => {
      expect(
        d.classifyOperation(JSON.stringify({ table: "users", op: "get" })),
      ).toBe(OperationType.READ);
    });
    it("put → DML", () => {
      expect(
        d.classifyOperation(JSON.stringify({ table: "users", op: "put" })),
      ).toBe(OperationType.DML);
    });
    it("delete → DML", () => {
      expect(
        d.classifyOperation(JSON.stringify({ table: "users", op: "delete" })),
      ).toBe(OperationType.DML);
    });
    it("createTable → DDL", () => {
      expect(
        d.classifyOperation(
          JSON.stringify({ table: "users", op: "createTable" }),
        ),
      ).toBe(OperationType.DDL);
    });
  });

  describe("DynamoDriver — AWS SDK command form", () => {
    const d = new DynamoDriver();
    it("ScanCommand → READ", () => {
      expect(
        d.classifyOperation(
          'await client.send(new ScanCommand({TableName: "users"}))',
        ),
      ).toBe(OperationType.READ);
    });
    it("PutItemCommand → DML", () => {
      expect(
        d.classifyOperation(
          'await client.send(new PutItemCommand({TableName: "users", Item: {}}))',
        ),
      ).toBe(OperationType.DML);
    });
    it("DeleteItemCommand → DML", () => {
      expect(
        d.classifyOperation(
          'await client.send(new DeleteItemCommand({TableName: "users", Key: {}}))',
        ),
      ).toBe(OperationType.DML);
    });
    it("CreateTableCommand → DDL", () => {
      expect(
        d.classifyOperation(
          'await client.send(new CreateTableCommand({TableName: "users"}))',
        ),
      ).toBe(OperationType.DDL);
    });
    it("empty input throws", () => {
      expect(() => d.classifyOperation("  ")).toThrow(/Empty DynamoDB statement/);
    });
  });

  // G-DYNAMO-PARSE-ERROR: a truncated JSON envelope used to fall
  // through to SDK-name regex matching and default to DDL with the
  // unhelpful "DDL statements are never allowed" deny reason. The
  // driver now surfaces a distinct parse error.
  describe("DynamoDriver — malformed envelope", () => {
    const d = new DynamoDriver();
    it("truncated envelope throws DynamoEnvelopeParseError, not DDL", () => {
      const truncated = '{"table":"users","op":"Get';
      expect(() => d.classifyOperation(truncated)).toThrow(
        DynamoEnvelopeParseError,
      );
      expect(() => d.classifyOperation(truncated)).toThrow(
        /Malformed envelope JSON/,
      );
    });
    it("trailing comma in envelope throws parse error", () => {
      expect(() => d.classifyOperation('{"op":"scan",}')).toThrow(
        DynamoEnvelopeParseError,
      );
    });
  });
});
