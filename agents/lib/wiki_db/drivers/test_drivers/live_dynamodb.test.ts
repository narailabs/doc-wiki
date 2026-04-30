/**
 * Live-integration tests for DynamoDriver. Skipped unless `TEST_LIVE_DYNAMO`
 * is set. Expects the dynamodb-local service from `fixtures/docker-compose.yml`.
 */
import { describe, expect, it } from "vitest";
import { DynamoDriver } from "../dynamodb.js";

describe.runIf(process.env["TEST_LIVE_DYNAMO"] !== undefined)(
  "wiki_db.drivers.dynamodb (live)",
  () => {
    it("lists tables from dynamodb-local", async () => {
      const drv = new DynamoDriver();
      const handle = await drv.connect({
        region: "us-east-1",
        endpoint:
          process.env["TEST_DYNAMO_ENDPOINT"] ?? "http://localhost:8000",
        credentials: {
          accessKeyId: "local",
          secretAccessKey: "local",
        },
      });
      try {
        const tables = await drv.getSchemaAsync(handle);
        expect(Array.isArray(tables)).toBe(true);
      } finally {
        await drv.closeAsync(handle);
      }
    });
  },
);
