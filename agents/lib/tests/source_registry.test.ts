/**
 * Tests for source_registry.ts — the static-pattern source-to-connector registry.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { makeTmpPath, cleanupTmpPath } from "./fixtures.js";

import {
  type AgentManifest,
  registerAgent,
  unregisterAgent,
  lookupBySource,
  lookupByName,
  listAgents,
  matchHostname,
  clearRegistry,
  initRegistry,
  registeredAgentIds,
  loadConfiguredConnectorIds,
} from "../source_registry.js";

// ── Helpers ───────────────────────────────────────────────────────────

function makeManifest(overrides: Partial<AgentManifest> = {}): AgentManifest {
  return {
    name: "test-agent",
    description: "Test agent",
    type: "source",
    autonomy_level: "supervised",
    model: "haiku",
    tools: ["Bash"],
    version: "1.0.0",
    source_schemes: [],
    source_url_patterns: [],
    invocation_template: {
      subagent_type: "test-agent",
      default_model: "haiku",
      label: "Test",
    },
    agent_dir: "",
    origin: "builtin",
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────

describe("matchHostname", () => {
  it("matches exact hostname", () => {
    expect(matchHostname("github.com", "github.com")).toBe(true);
    expect(matchHostname("github.com", "gitlab.com")).toBe(false);
  });

  it("matches wildcard prefix", () => {
    expect(matchHostname("*.atlassian.net", "company.atlassian.net")).toBe(true);
    expect(matchHostname("*.atlassian.net", "atlassian.net")).toBe(true);
    expect(matchHostname("*.atlassian.net", "evil.com")).toBe(false);
  });

  it("matches nested subdomains with wildcard", () => {
    expect(matchHostname("*.github.com", "pages.github.com")).toBe(true);
    expect(matchHostname("*.github.com", "deep.pages.github.com")).toBe(true);
  });
});

describe("registry CRUD", () => {
  beforeEach(() => clearRegistry());
  afterEach(() => clearRegistry());

  it("registers and looks up by name", () => {
    const m = makeManifest({ name: "my-agent" });
    registerAgent(m);
    expect(lookupByName("my-agent")).toBe(m);
    expect(lookupByName("nonexistent")).toBeNull();
  });

  it("unregisters an agent", () => {
    registerAgent(makeManifest({ name: "temp" }));
    expect(unregisterAgent("temp")).toBe(true);
    expect(lookupByName("temp")).toBeNull();
    expect(unregisterAgent("temp")).toBe(false);
  });

  it("lists all agents with optional filter", () => {
    registerAgent(makeManifest({ name: "a", type: "source" }));
    registerAgent(makeManifest({ name: "b", type: "database" }));
    registerAgent(makeManifest({ name: "c", type: "source", origin: "custom" }));
    expect(listAgents()).toHaveLength(3);
    expect(listAgents({ type: "source" })).toHaveLength(2);
    expect(listAgents({ origin: "custom" })).toHaveLength(1);
  });

  it("clearRegistry removes all agents", () => {
    registerAgent(makeManifest({ name: "a" }));
    registerAgent(makeManifest({ name: "b" }));
    clearRegistry();
    expect(listAgents()).toHaveLength(0);
  });
});

describe("lookupBySource", () => {
  beforeEach(() => clearRegistry());
  afterEach(() => clearRegistry());

  it("returns null for empty string", () => {
    expect(lookupBySource("")).toBeNull();
  });

  it("matches by scheme", () => {
    registerAgent(makeManifest({
      name: "wiki-jira-agent",
      source_schemes: ["jira://"],
    }));
    const result = lookupBySource("jira://AUTH-123");
    expect(result?.name).toBe("wiki-jira-agent");
  });

  it("matches by URL hostname", () => {
    registerAgent(makeManifest({
      name: "wiki-github-agent",
      source_url_patterns: [{ hostname: "github.com" }],
    }));
    const result = lookupBySource("https://github.com/org/repo/pull/42");
    expect(result?.name).toBe("wiki-github-agent");
  });

  it("matches by URL hostname with wildcard", () => {
    registerAgent(makeManifest({
      name: "wiki-gcp-agent",
      source_url_patterns: [{ hostname: "*.cloud.google.com" }],
    }));
    expect(lookupBySource("https://console.cloud.google.com/run")?.name).toBe("wiki-gcp-agent");
  });

  it("disambiguates by path_prefix", () => {
    registerAgent(makeManifest({
      name: "wiki-jira-agent",
      source_url_patterns: [{ hostname: "*.atlassian.net", path_prefix: "/browse/" }],
    }));
    registerAgent(makeManifest({
      name: "wiki-confluence-agent",
      source_url_patterns: [{ hostname: "*.atlassian.net", path_prefix: "/wiki/" }],
    }));

    expect(lookupBySource("https://co.atlassian.net/browse/AUTH-1")?.name).toBe("wiki-jira-agent");
    expect(lookupBySource("https://co.atlassian.net/wiki/spaces/A")?.name).toBe("wiki-confluence-agent");
  });

  it("matches path_contains", () => {
    registerAgent(makeManifest({
      name: "wiki-confluence-agent",
      source_url_patterns: [
        { hostname: "*.atlassian.net", path_prefix: "/wiki/" },
        { hostname: "*.atlassian.net", path_contains: "/spaces/" },
      ],
    }));
    expect(lookupBySource("https://co.atlassian.net/x/spaces/ARCH")?.name).toBe("wiki-confluence-agent");
  });

  it("returns null for unmatched URL", () => {
    registerAgent(makeManifest({ name: "wiki-jira-agent", source_schemes: ["jira://"] }));
    expect(lookupBySource("https://unknown.com/page")).toBeNull();
  });

  it("returns null for unmatched scheme", () => {
    registerAgent(makeManifest({ name: "wiki-jira-agent", source_schemes: ["jira://"] }));
    expect(lookupBySource("custom://foo")).toBeNull();
  });

  it("matches scheme case-insensitively", () => {
    registerAgent(makeManifest({
      name: "wiki-db-agent",
      source_schemes: ["db://"],
    }));
    expect(lookupBySource("DB://dev/users")?.name).toBe("wiki-db-agent");
  });

  it("matches custom agent by scheme", () => {
    registerAgent(makeManifest({
      name: "my-internal-agent",
      source_schemes: ["internal://"],
      origin: "custom",
    }));
    expect(lookupBySource("internal://kb/article-123")?.name).toBe("my-internal-agent");
  });
});

describe("initRegistry — builtin patterns", () => {
  afterEach(() => clearRegistry());

  it("populates registry with the 7 builtin connectors", () => {
    initRegistry();
    const agents = listAgents();
    const names = agents.map((a) => a.name).sort();
    expect(names).toEqual([
      "wiki-aws-agent",
      "wiki-confluence-agent",
      "wiki-db-agent",
      "wiki-gcp-agent",
      "wiki-github-agent",
      "wiki-jira-agent",
      "wiki-notion-agent",
    ]);
  });

  it("integrates lookup after init", () => {
    initRegistry();
    expect(lookupBySource("jira://AUTH-1")?.name).toBe("wiki-jira-agent");
    expect(lookupBySource("db://dev/users")?.name).toBe("wiki-db-agent");
    expect(lookupBySource("https://github.com/org/repo")?.name).toBe("wiki-github-agent");
    expect(lookupBySource("https://co.atlassian.net/browse/T-1")?.name).toBe("wiki-jira-agent");
    expect(lookupBySource("https://co.atlassian.net/wiki/spaces/X")?.name).toBe("wiki-confluence-agent");
  });

  it("labels each builtin connector", () => {
    initRegistry();
    expect(lookupByName("wiki-jira-agent")?.invocation_template.label).toBe("Jira");
    expect(lookupByName("wiki-db-agent")?.invocation_template.label).toBe("Database");
    expect(lookupByName("wiki-github-agent")?.invocation_template.label).toBe("GitHub");
  });

  it("classifies db as type=database, others as type=source", () => {
    initRegistry();
    expect(lookupByName("wiki-db-agent")?.type).toBe("database");
    expect(lookupByName("wiki-jira-agent")?.type).toBe("source");
    expect(lookupByName("wiki-github-agent")?.type).toBe("source");
  });

  it("registers custom agents from config alongside builtins", () => {
    initRegistry({
      customAgents: [
        {
          name: "my-kb-agent",
          source_schemes: ["kb://"],
          invocation_template: { subagent_type: "my-kb-agent", default_model: "haiku", label: "Knowledge Base" },
        },
      ],
    });
    expect(lookupBySource("kb://article-42")?.name).toBe("my-kb-agent");
    expect(lookupBySource("kb://article-42")?.origin).toBe("custom");
    // Builtins are still present
    expect(lookupBySource("jira://X")?.name).toBe("wiki-jira-agent");
  });

  it("custom agents override builtins on name collision", () => {
    initRegistry({
      customAgents: [
        {
          name: "wiki-jira-agent",
          source_schemes: ["custom-jira://"],
          invocation_template: { subagent_type: "wiki-jira-agent", default_model: "sonnet", label: "Custom Jira" },
        },
      ],
    });
    const agent = lookupByName("wiki-jira-agent");
    expect(agent?.origin).toBe("custom");
    expect(agent?.invocation_template.label).toBe("Custom Jira");
    expect(agent?.source_schemes).toEqual(["custom-jira://"]);
  });

  it("is idempotent — clears state on each call", () => {
    initRegistry();
    const before = listAgents().length;
    initRegistry();
    expect(listAgents().length).toBe(before);
  });
});

describe("registeredAgentIds", () => {
  beforeEach(() => clearRegistry());
  afterEach(() => clearRegistry());

  it("extracts short IDs from agent names", () => {
    registerAgent(makeManifest({ name: "wiki-jira-agent" }));
    registerAgent(makeManifest({ name: "wiki-db-agent" }));
    const ids = registeredAgentIds();
    expect(ids.has("jira")).toBe(true);
    expect(ids.has("db")).toBe(true);
  });

  it("returns the 7 builtin connector IDs after init", () => {
    initRegistry();
    const ids = registeredAgentIds();
    expect(ids).toEqual(new Set(["jira", "confluence", "github", "notion", "gcp", "aws", "db"]));
  });
});

// ── loadConfiguredConnectorIds ────────────────────────────────────────

describe("loadConfiguredConnectorIds", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpPath("connectors-config-test-");
    fs.mkdirSync(path.join(tmpDir, ".connectors"), { recursive: true });
  });

  afterEach(() => {
    cleanupTmpPath(tmpDir);
  });

  it("returns configured IDs: enabled:true included, enabled:false excluded, empty-map included", () => {
    const configPath = path.join(tmpDir, ".connectors", "config.yaml");
    fs.writeFileSync(
      configPath,
      "connectors:\n  db:\n    enabled: true\n  jira:\n    enabled: false\n  github: {}\n",
    );
    const ids = loadConfiguredConnectorIds(configPath);
    expect(ids).toEqual(new Set(["db", "github"]));
  });

  it("returns empty Set when file does not exist", () => {
    const ids = loadConfiguredConnectorIds(path.join(tmpDir, ".connectors", "nonexistent.yaml"));
    expect(ids.size).toBe(0);
  });

  it("returns empty Set when connectors block is absent", () => {
    const configPath = path.join(tmpDir, ".connectors", "config.yaml");
    fs.writeFileSync(configPath, "environments:\n  default: dev\n");
    const ids = loadConfiguredConnectorIds(configPath);
    expect(ids.size).toBe(0);
  });

  it("includes connectors with extra keys when enabled is true", () => {
    const configPath = path.join(tmpDir, ".connectors", "config.yaml");
    fs.writeFileSync(
      configPath,
      "connectors:\n  aws:\n    enabled: true\n    region: env:AWS_REGION\n  gcp:\n    enabled: true\n    project_id: env:GCP_PROJECT_ID\n",
    );
    const ids = loadConfiguredConnectorIds(configPath);
    expect(ids.has("aws")).toBe(true);
    expect(ids.has("gcp")).toBe(true);
  });

  it("excludes all when every connector has enabled:false", () => {
    const configPath = path.join(tmpDir, ".connectors", "config.yaml");
    fs.writeFileSync(configPath, "connectors:\n  jira:\n    enabled: false\n  notion:\n    enabled: false\n");
    const ids = loadConfiguredConnectorIds(configPath);
    expect(ids.size).toBe(0);
  });
});
