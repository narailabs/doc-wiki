import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadRepoConfig } from "../repo_config.js";

const VALID = `
id: demo
github: acme/demo
clone_url: https://github.com/acme/demo.git
language: typescript
ticket_source: github
install: ["npm ci"]
test_command: "npx vitest run {test_files}"
test_patterns: ["test/**", "**/*.test.ts"]
ticket_after: 2025-06-01
toolchain: ["node:22"]
`;

function writeCfg(yaml: string): string {
  const dir = mkdtempSync(join(tmpdir(), "benchcfg-"));
  const p = join(dir, "demo.yaml");
  writeFileSync(p, yaml);
  return p;
}

describe("loadRepoConfig", () => {
  it("parses a valid config and applies defaults", () => {
    const cfg = loadRepoConfig(writeCfg(VALID));
    expect(cfg.id).toBe("demo");
    expect(cfg.test_retries).toBe(0);
    expect(cfg.services).toEqual([]);
    expect(cfg.wiki_commit).toBe("");
    // js-yaml parses unquoted ISO dates as Date — loader must normalize back
    expect(cfg.ticket_after).toBe("2025-06-01");
  });

  it("rejects a test_command without {test_files}", () => {
    expect(() => loadRepoConfig(writeCfg(VALID.replace("{test_files}", "")))).toThrow(/test_command/);
  });

  it("rejects missing test_patterns", () => {
    expect(() => loadRepoConfig(writeCfg(VALID.replace(/test_patterns:.*\n/, "")))).toThrow(/test_patterns/);
  });

  it("rejects unknown ticket_source", () => {
    expect(() => loadRepoConfig(writeCfg(VALID.replace("github\n", "linear\n")))).toThrow(/ticket_source/);
  });

  it("rejects a ticket_after that is not YYYY-MM-DD", () => {
    expect(() => loadRepoConfig(writeCfg(VALID.replace("2025-06-01", "not-a-date")))).toThrow(/ticket_after/);
  });

  it("rejects install entries that are not strings", () => {
    const yaml = VALID.replace('install: ["npm ci"]', 'install:\n  - run: "npm ci"');
    expect(() => loadRepoConfig(writeCfg(yaml))).toThrow(/install/);
  });

  it("rejects a non-integer test_retries", () => {
    expect(() => loadRepoConfig(writeCfg(VALID + 'test_retries: "abc"\n'))).toThrow(/test_retries/);
  });
});

describe("runnable-test config fields", () => {
  it("defaults run_patterns to test_patterns and exclude_test_paths to []", () => {
    const cfg = loadRepoConfig(writeCfg(VALID));
    expect(cfg.run_patterns).toEqual(cfg.test_patterns);
    expect(cfg.exclude_test_paths).toEqual([]);
  });

  it("accepts explicit lists and rejects non-string entries", () => {
    const cfg = loadRepoConfig(writeCfg(`${VALID}run_patterns: ["**/*.test.ts"]\nexclude_test_paths: ["test/browser/**"]\n`));
    expect(cfg.run_patterns).toEqual(["**/*.test.ts"]);
    expect(cfg.exclude_test_paths).toEqual(["test/browser/**"]);
    expect(() => loadRepoConfig(writeCfg(`${VALID}run_patterns: [{a: 1}]\n`))).toThrow(/run_patterns/);
  });
});

describe("services / container_env / system_packages fields", () => {
  it("defaults all three to empty when absent", () => {
    const cfg = loadRepoConfig(writeCfg(VALID));
    expect(cfg.services).toEqual([]);
    expect(cfg.container_env).toEqual({});
    expect(cfg.system_packages).toEqual([]);
  });

  it("parses a structured services list", () => {
    const yaml = `${VALID}
services:
  - name: db
    image: postgres:15-alpine
    env:
      POSTGRES_USER: saleor
      POSTGRES_PASSWORD: saleor
      POSTGRES_DB: saleor
    ready: "pg_isready -U saleor"
  - name: cache
    image: valkey/valkey:8.1-alpine
`;
    const cfg = loadRepoConfig(writeCfg(yaml));
    expect(cfg.services).toHaveLength(2);
    expect(cfg.services[0]).toEqual({
      name: "db",
      image: "postgres:15-alpine",
      env: { POSTGRES_USER: "saleor", POSTGRES_PASSWORD: "saleor", POSTGRES_DB: "saleor" },
      ready: "pg_isready -U saleor",
    });
    expect(cfg.services[1]).toEqual({
      name: "cache",
      image: "valkey/valkey:8.1-alpine",
      env: {},
      ready: undefined,
    });
  });

  it("rejects bare-string services entries", () => {
    const yaml = `${VALID}services:\n  - postgres:15-alpine\n`;
    expect(() => loadRepoConfig(writeCfg(yaml))).toThrow(/services must be a list of \{name, image\} objects/);
  });

  it("rejects a service missing name or image", () => {
    const missingName = `${VALID}services:\n  - image: postgres:15-alpine\n`;
    expect(() => loadRepoConfig(writeCfg(missingName))).toThrow(/name/);
    const missingImage = `${VALID}services:\n  - name: db\n`;
    expect(() => loadRepoConfig(writeCfg(missingImage))).toThrow(/image/);
  });

  it("parses container_env and system_packages", () => {
    const yaml = `${VALID}
container_env:
  DATABASE_URL: "postgres://saleor:saleor@db:5432/saleor"
  CACHE_URL: "redis://cache:6379/0"
system_packages:
  - libpq-dev
`;
    const cfg = loadRepoConfig(writeCfg(yaml));
    expect(cfg.container_env).toEqual({
      DATABASE_URL: "postgres://saleor:saleor@db:5432/saleor",
      CACHE_URL: "redis://cache:6379/0",
    });
    expect(cfg.system_packages).toEqual(["libpq-dev"]);
  });

  it("rejects non-string system_packages entries", () => {
    const yaml = `${VALID}system_packages:\n  - 123\n`;
    expect(() => loadRepoConfig(writeCfg(yaml))).toThrow(/system_packages/);
  });

  it("accepts services: [] (empty list)", () => {
    const cfg = loadRepoConfig(writeCfg(`${VALID}services: []\n`));
    expect(cfg.services).toEqual([]);
  });
});
