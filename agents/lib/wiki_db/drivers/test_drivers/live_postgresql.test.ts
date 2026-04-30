/**
 * Live-integration tests for PostgresDriver.
 *
 * Skipped unless `TEST_LIVE_PG` is set in the environment. Expects a
 * Postgres container from `fixtures/docker-compose.yml`:
 *   docker compose up -d postgres
 *   TEST_LIVE_PG=1 npx vitest run .../live_postgresql.test.ts
 *
 * No mocks in this file — the real `pg` package must be installed.
 */
import { describe, expect, it } from "vitest";
import { PostgresDriver } from "../postgresql.js";

describe.runIf(process.env["TEST_LIVE_PG"] !== undefined)(
  "wiki_db.drivers.postgresql (live)",
  () => {
    it("connects, SELECTs, and closes against docker-compose postgres", async () => {
      const drv = new PostgresDriver();
      const handle = await drv.connect({
        host: process.env["TEST_PG_HOST"] ?? "localhost",
        port: Number(process.env["TEST_PG_PORT"] ?? 5432),
        database: process.env["TEST_PG_DB"] ?? "postgres",
        user: process.env["TEST_PG_USER"] ?? "postgres",
        password: process.env["TEST_PG_PASSWORD"] ?? "postgres",
      });
      try {
        const res = await drv.executeReadAsync(handle, "SELECT 1 AS one");
        expect(res.status).toBe("success");
        expect(res.rows![0]!["one"]).toBe(1);
      } finally {
        await drv.closeAsync(handle);
      }
    });
  },
);
