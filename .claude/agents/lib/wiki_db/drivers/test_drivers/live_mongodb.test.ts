/**
 * Live-integration tests for MongoDriver. Skipped unless `TEST_LIVE_MONGO`
 * is set. Expects a mongodb container from `fixtures/docker-compose.yml`.
 */
import { describe, expect, it } from "vitest";
import { MongoDriver } from "../mongodb.js";

describe.runIf(process.env["TEST_LIVE_MONGO"] !== undefined)(
  "wiki_db.drivers.mongodb (live)",
  () => {
    it("connects to docker-compose mongodb and lists collections", async () => {
      const drv = new MongoDriver();
      const handle = await drv.connect({
        uri: process.env["TEST_MONGO_URI"] ?? "mongodb://localhost:27017",
        database: process.env["TEST_MONGO_DB"] ?? "test",
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
