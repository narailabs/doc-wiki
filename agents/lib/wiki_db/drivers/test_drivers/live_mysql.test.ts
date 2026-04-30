/**
 * Live-integration tests for MysqlDriver. Skipped unless `TEST_LIVE_MYSQL`
 * is set. Expects a MySQL container from `fixtures/docker-compose.yml`.
 */
import { describe, expect, it } from "vitest";
import { MysqlDriver } from "../mysql.js";

describe.runIf(process.env["TEST_LIVE_MYSQL"] !== undefined)(
  "wiki_db.drivers.mysql (live)",
  () => {
    it("connects to docker-compose mysql and runs SELECT 1", async () => {
      const drv = new MysqlDriver();
      const handle = await drv.connect({
        host: process.env["TEST_MYSQL_HOST"] ?? "localhost",
        port: Number(process.env["TEST_MYSQL_PORT"] ?? 3306),
        database: process.env["TEST_MYSQL_DB"] ?? "mysql",
        user: process.env["TEST_MYSQL_USER"] ?? "root",
        password: process.env["TEST_MYSQL_PASSWORD"] ?? "root",
      });
      try {
        const res = await drv.executeReadAsync(handle, "SELECT 1 AS one");
        expect(res.status).toBe("success");
      } finally {
        await drv.closeAsync(handle);
      }
    });
  },
);
