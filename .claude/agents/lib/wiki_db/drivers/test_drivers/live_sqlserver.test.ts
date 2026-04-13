/**
 * Live-integration tests for SqlServerDriver. Skipped unless
 * `TEST_LIVE_MSSQL` is set. Expects an mssql container from
 * `fixtures/docker-compose.yml`.
 */
import { describe, expect, it } from "vitest";
import { SqlServerDriver } from "../sqlserver.js";

describe.runIf(process.env["TEST_LIVE_MSSQL"] !== undefined)(
  "wiki_db.drivers.sqlserver (live)",
  () => {
    it("connects to docker-compose mssql and runs SELECT 1", async () => {
      const drv = new SqlServerDriver();
      const handle = await drv.connect({
        host: process.env["TEST_MSSQL_HOST"] ?? "localhost",
        port: Number(process.env["TEST_MSSQL_PORT"] ?? 1433),
        database: process.env["TEST_MSSQL_DB"] ?? "master",
        user: process.env["TEST_MSSQL_USER"] ?? "sa",
        password: process.env["TEST_MSSQL_PASSWORD"] ?? "YourStrong@Pass1",
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
