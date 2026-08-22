/**
 * Tests for source_registry.ts — the static-pattern source-to-connector registry.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { makeTmpPath, cleanupTmpPath, writeConfigYaml } from "./fixtures.js";

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
  initRegistryFromConfig,
  loadCustomAgentConfigs,
  registeredAgentIds,
  loadConfiguredConnectorIds,
  resolveWikiConfigPath,
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

  it("matches schemes containing digits, plus, dot, or dash (RFC 3986)", () => {
    registerAgent(makeManifest({
      name: "s3-agent",
      source_schemes: ["s3://"],
      origin: "custom",
    }));
    registerAgent(makeManifest({
      name: "kb-v2-agent",
      source_schemes: ["kb-v2://"],
      origin: "custom",
    }));
    expect(lookupBySource("s3://bucket/key.txt")?.name).toBe("s3-agent");
    expect(lookupBySource("kb-v2://article/1")?.name).toBe("kb-v2-agent");
  });
});

describe("initRegistry — builtin patterns", () => {
  afterEach(() => clearRegistry());

  it("populates registry with the 9 builtin connectors", () => {
    initRegistry();
    const agents = listAgents();
    const names = agents.map((a) => a.name).sort();
    expect(names).toEqual([
      "wiki-aws-agent",
      "wiki-confluence-agent",
      "wiki-db-agent",
      "wiki-gcp-agent",
      "wiki-github-agent",
      "wiki-gitlab-agent",
      "wiki-jira-agent",
      "wiki-linear-agent",
      "wiki-notion-agent",
    ]);
  });

  it("integrates lookup after init", () => {
    initRegistry();
    expect(lookupBySource("jira://AUTH-1")?.name).toBe("wiki-jira-agent");
    expect(lookupBySource("db://dev/users")?.name).toBe("wiki-db-agent");
    expect(lookupBySource("https://github.com/org/repo")?.name).toBe("wiki-github-agent");
    expect(lookupBySource("https://gitlab.com/org/repo")?.name).toBe("wiki-gitlab-agent");
    expect(lookupBySource("https://linear.app/acme/issue/ENG-1")?.name).toBe("wiki-linear-agent");
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

  it("routes a mixed-case declared scheme — schemes are case-insensitive", () => {
    // `lookupBySource` lowercases the scheme it parses out of a source and
    // compares case-sensitively. `validateCustomAgentEntry` accepts "KB://"
    // (its regex is case-insensitive), so without normalization at
    // registration this connector would load cleanly and never match.
    initRegistry({
      customAgents: [
        {
          name: "my-kb-agent",
          source_schemes: ["KB://", "S3+SSL://"],
          invocation_template: { subagent_type: "my-kb-agent", default_model: "haiku", label: "Knowledge Base" },
        },
      ],
    });
    expect(lookupByName("my-kb-agent")?.source_schemes).toEqual(["kb://", "s3+ssl://"]);
    expect(lookupBySource("kb://article-42")?.name).toBe("my-kb-agent");
    expect(lookupBySource("KB://article-42")?.name).toBe("my-kb-agent");
    expect(lookupBySource("s3+ssl://bucket/key")?.name).toBe("my-kb-agent");
  });

  it("routes a mixed-case declared hostname — hostnames are case-insensitive", () => {
    // `matchHostname` compares case-sensitively against `new URL(x).hostname`,
    // which the URL parser has already lowercased. Without normalization at
    // registration, a config declaring "GitLab.Example.com" would load cleanly
    // and never match, for any casing of the source.
    initRegistry({
      customAgents: [
        {
          name: "my-gitlab-agent",
          source_url_patterns: [{ hostname: "GitLab.Example.com" }, { hostname: "*.Corp.Example.COM" }],
          invocation_template: { subagent_type: "my-gitlab-agent", default_model: "haiku", label: "GitLab" },
        },
      ],
    });
    expect(lookupByName("my-gitlab-agent")?.source_url_patterns).toEqual([
      { hostname: "gitlab.example.com" },
      { hostname: "*.corp.example.com" },
    ]);
    expect(lookupBySource("https://GitLab.Example.com/g/p")?.name).toBe("my-gitlab-agent");
    expect(lookupBySource("https://gitlab.example.com/g/p")?.name).toBe("my-gitlab-agent");
    // The leading-`*.` glob branch of matchHostname folds too.
    expect(lookupBySource("https://Team.Corp.Example.com/x")?.name).toBe("my-gitlab-agent");
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

  it("returns the 9 builtin connector IDs after init", () => {
    initRegistry();
    const ids = registeredAgentIds();
    expect(ids).toEqual(new Set(["jira", "confluence", "github", "gitlab", "notion", "linear", "gcp", "aws", "db"]));
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

// ── loadCustomAgentConfigs ────────────────────────────────────────────

describe("loadCustomAgentConfigs", () => {
  let tmpDir: string;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmpDir = makeTmpPath("custom-agents-test-");
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    cleanupTmpPath(tmpDir);
  });

  /** Minimal valid wiki.config.yaml with the given custom block. */
  function configWithCustom(custom: unknown): Record<string, unknown> {
    return {
      wiki: { name: "test-wiki" },
      ecosystem: { agents: { custom } },
    };
  }

  it("returns [] when the config file does not exist", () => {
    const configs = loadCustomAgentConfigs(path.join(tmpDir, "missing.yaml"));
    expect(configs).toEqual([]);
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it("returns [] when ecosystem.agents.custom is absent", () => {
    const p = writeConfigYaml(tmpDir, { wiki: { name: "test-wiki" } });
    expect(loadCustomAgentConfigs(p)).toEqual([]);
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it("loads well-formed custom entries", () => {
    const p = writeConfigYaml(tmpDir, configWithCustom([
      {
        name: "kb",
        source_schemes: ["kb://"],
        invocation_template: { label: "Knowledge Base" },
      },
    ]));
    const configs = loadCustomAgentConfigs(p);
    expect(configs).toHaveLength(1);
    expect(configs[0]?.name).toBe("kb");
    expect(configs[0]?.source_schemes).toEqual(["kb://"]);
    expect(configs[0]?.invocation_template?.label).toBe("Knowledge Base");
  });

  it("skips malformed entries with a warning and keeps valid ones", () => {
    const p = writeConfigYaml(tmpDir, configWithCustom([
      { source_schemes: ["broken://"] }, // missing name
      "not-a-mapping",
      { name: "kb", source_schemes: ["kb://"] },
    ]));
    const configs = loadCustomAgentConfigs(p);
    expect(configs).toHaveLength(1);
    expect(configs[0]?.name).toBe("kb");
    expect(stderrSpy).toHaveBeenCalled();
  });

  it("skips entries whose source_url_patterns lack a hostname", () => {
    const p = writeConfigYaml(tmpDir, configWithCustom([
      { name: "bad", source_url_patterns: [{ path_prefix: "/x/" }] },
    ]));
    expect(loadCustomAgentConfigs(p)).toEqual([]);
    expect(stderrSpy).toHaveBeenCalled();
  });

  it("accepts schemes with digits/plus/dot/dash, rejects malformed ones", () => {
    const p = writeConfigYaml(tmpDir, configWithCustom([
      { name: "s3", source_schemes: ["s3://"] },
      { name: "bad-no-slashes", source_schemes: ["kb"] },
      { name: "bad-underscore", source_schemes: ["my_kb://"] },
    ]));
    const configs = loadCustomAgentConfigs(p);
    expect(configs.map((c) => c.name)).toEqual(["s3"]);
    expect(stderrSpy).toHaveBeenCalled();
  });

  it("warns and returns [] when custom is not a list", () => {
    const p = writeConfigYaml(tmpDir, configWithCustom({ name: "kb" }));
    expect(loadCustomAgentConfigs(p)).toEqual([]);
    expect(stderrSpy).toHaveBeenCalled();
  });

  it("warns and returns [] when the config itself fails validation", () => {
    const p = path.join(tmpDir, "wiki.config.yaml");
    fs.writeFileSync(p, "autonomy:\n  mode: balanced\n"); // missing wiki.name
    expect(loadCustomAgentConfigs(p)).toEqual([]);
    expect(stderrSpy).toHaveBeenCalled();
  });
});

// ── initRegistryFromConfig ────────────────────────────────────────────

describe("initRegistryFromConfig", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpPath("custom-agents-init-");
  });

  afterEach(() => {
    cleanupTmpPath(tmpDir);
    clearRegistry();
  });

  it("classifies a custom kb:// scheme alongside builtins", () => {
    const p = writeConfigYaml(tmpDir, {
      wiki: { name: "test-wiki" },
      ecosystem: {
        agents: {
          custom: [
            {
              name: "kb",
              source_schemes: ["kb://"],
              invocation_template: { label: "Knowledge Base" },
            },
          ],
        },
      },
    });
    initRegistryFromConfig(p);
    expect(lookupBySource("kb://article-42")?.name).toBe("kb");
    expect(lookupBySource("kb://article-42")?.origin).toBe("custom");
    // Builtins are still present
    expect(lookupBySource("jira://AUTH-1")?.name).toBe("wiki-jira-agent");
  });

  it("classifies a self-hosted GitLab host via a builtin override", () => {
    // Exact shape documented in docs/connectors.md § gitlab. Overriding
    // wiki-gitlab-agent REPLACES the builtin patterns, so the snippet
    // restates gitlab.com alongside the self-hosted host.
    const p = writeConfigYaml(tmpDir, {
      wiki: { name: "test-wiki" },
      ecosystem: {
        agents: {
          custom: [
            {
              name: "wiki-gitlab-agent",
              source_schemes: ["gitlab://"],
              source_url_patterns: [
                { hostname: "gitlab.com" },
                { hostname: "*.gitlab.com" },
                { hostname: "gitlab.example.com" },
              ],
              invocation_template: { label: "GitLab" },
            },
          ],
        },
      },
    });
    initRegistryFromConfig(p);
    const selfHosted = lookupBySource("https://gitlab.example.com/group/proj/-/merge_requests/7");
    expect(selfHosted?.name).toBe("wiki-gitlab-agent");
    expect(selfHosted?.origin).toBe("custom");
    // gitlab.com still classifies after the override
    expect(lookupBySource("https://gitlab.com/org/repo")?.name).toBe("wiki-gitlab-agent");
  });

  it("falls back to builtins-only when no config exists", () => {
    initRegistryFromConfig(path.join(tmpDir, "missing.yaml"));
    expect(listAgents()).toHaveLength(9);
    expect(lookupBySource("kb://article-42")).toBeNull();
  });
});

// ── resolveWikiConfigPath ─────────────────────────────────────────────

describe("resolveWikiConfigPath", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpPath("resolve-wiki-config-");
  });

  afterEach(() => {
    cleanupTmpPath(tmpDir);
  });

  it("returns <root>/wiki.config.yaml when present", () => {
    const p = path.join(tmpDir, "wiki.config.yaml");
    fs.writeFileSync(p, "wiki:\n  name: t\n");
    expect(resolveWikiConfigPath(tmpDir)).toBe(p);
  });

  it("falls back to <root>/wiki/wiki.config.yaml when the root copy is missing", () => {
    fs.mkdirSync(path.join(tmpDir, "wiki"), { recursive: true });
    const p = path.join(tmpDir, "wiki", "wiki.config.yaml");
    fs.writeFileSync(p, "wiki:\n  name: t\n");
    expect(resolveWikiConfigPath(tmpDir)).toBe(p);
  });

  it("returns null when neither location exists", () => {
    expect(resolveWikiConfigPath(tmpDir)).toBeNull();
  });
});
