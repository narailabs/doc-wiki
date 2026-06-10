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
