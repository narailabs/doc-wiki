/**
 * Tests for source_registry.ts — agent discovery, registration, and lookup.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import {
  type AgentManifest,
  parseFrontmatter,
  buildManifest,
  discoverAgents,
  registerAgent,
  unregisterAgent,
  lookupBySource,
  lookupByName,
  listAgents,
  matchHostname,
  clearRegistry,
  initRegistry,
  registeredAgentIds,
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
    agent_dir: "/tmp/test-agent",
    origin: "builtin",
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────

describe("parseFrontmatter", () => {
  it("parses simple key-value pairs", () => {
    const fm = parseFrontmatter("---\nname: wiki-test-agent\nmodel: haiku\n---\n# Body");
    expect(fm["name"]).toBe("wiki-test-agent");
    expect(fm["model"]).toBe("haiku");
  });

  it("parses inline arrays", () => {
    const fm = parseFrontmatter("---\ntools: [Bash, Read, Write]\n---");
    expect(fm["tools"]).toEqual(["Bash", "Read", "Write"]);
  });

  it("parses quoted strings", () => {
    const fm = parseFrontmatter('---\nversion: "1.0.0"\ncolor: \'red\'\n---');
    expect(fm["version"]).toBe("1.0.0");
    expect(fm["color"]).toBe("red");
  });

  it("parses scheme arrays with quotes", () => {
    const fm = parseFrontmatter('---\nsource_schemes: ["db://", "database://"]\n---');
    expect(fm["source_schemes"]).toEqual(["db://", "database://"]);
  });

  it("returns empty object when no frontmatter", () => {
    expect(parseFrontmatter("# Just markdown")).toEqual({});
  });

  it("ignores comments", () => {
    const fm = parseFrontmatter("---\nname: test\n# comment line\nmodel: haiku\n---");
    expect(fm["name"]).toBe("test");
    expect(fm["model"]).toBe("haiku");
  });
});

describe("buildManifest", () => {
  it("builds manifest from frontmatter", () => {
    const fm = { name: "wiki-db-agent", type: "database", model: "haiku", tools: ["Bash"] };
    const m = buildManifest(fm, "/agents/wiki-db-agent");
    expect(m.name).toBe("wiki-db-agent");
    expect(m.type).toBe("database");
    expect(m.source_schemes).toEqual(["db://"]); // from BUILTIN_DEFAULTS
    expect(m.invocation_template.label).toBe("Database");
  });

  it("falls back to BUILTIN_DEFAULTS for known agents", () => {
    const fm = { name: "wiki-jira-agent", type: "source" };
    const m = buildManifest(fm, "/agents/wiki-jira-agent");
    expect(m.source_schemes).toEqual(["jira://"]);
    expect(m.source_url_patterns).toHaveLength(1);
    expect(m.source_url_patterns[0]!.hostname).toBe("*.atlassian.net");
  });

  it("uses frontmatter source_schemes when provided", () => {
    const fm = { name: "custom-agent", source_schemes: ["custom://"] };
    const m = buildManifest(fm, "/agents/custom-agent");
    expect(m.source_schemes).toEqual(["custom://"]);
  });
});

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

describe("discoverAgents", () => {
  it("discovers agents from the real .claude/agents directory", () => {
    const agentsDir = path.resolve(__dirname, "../../");
    const agents = discoverAgents(agentsDir);
    // Should find at least the 10 shipped agents
    expect(agents.length).toBeGreaterThanOrEqual(10);
    const names = agents.map((a) => a.name);
    expect(names).toContain("wiki-db-agent");
    expect(names).toContain("wiki-github-agent");
    expect(names).toContain("wiki-jira-agent");
  });

  it("returns empty array for nonexistent directory", () => {
    expect(discoverAgents("/nonexistent/path")).toEqual([]);
  });

  it("applies BUILTIN_DEFAULTS for known agents", () => {
    const agentsDir = path.resolve(__dirname, "../../");
    const agents = discoverAgents(agentsDir);
    const jira = agents.find((a) => a.name === "wiki-jira-agent");
    expect(jira).toBeDefined();
    expect(jira!.source_schemes).toEqual(["jira://"]);
    expect(jira!.invocation_template.label).toBe("Jira");
  });
});

describe("initRegistry", () => {
  afterEach(() => clearRegistry());

  it("populates registry from real agents dir", () => {
    const agentsDir = path.resolve(__dirname, "../../");
    initRegistry({ agentsDir });
    expect(listAgents().length).toBeGreaterThanOrEqual(10);
  });

  it("integrates lookup after init", () => {
    const agentsDir = path.resolve(__dirname, "../../");
    initRegistry({ agentsDir });
    expect(lookupBySource("jira://AUTH-1")?.name).toBe("wiki-jira-agent");
    expect(lookupBySource("db://dev/users")?.name).toBe("wiki-db-agent");
    expect(lookupBySource("https://github.com/org/repo")?.name).toBe("wiki-github-agent");
    expect(lookupBySource("https://co.atlassian.net/browse/T-1")?.name).toBe("wiki-jira-agent");
  });

  it("registers custom agents from config", () => {
    const agentsDir = path.resolve(__dirname, "../../");
    initRegistry({
      agentsDir,
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
});
