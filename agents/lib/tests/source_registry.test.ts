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
  ensureRegistryForConfig,
  _resetRegistryConfigState,
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

  it("keeps a custom name that ends in -agent intact", () => {
    // Regression (Codex P2): `wiki-<id>-agent` is the BUILTIN manifest naming
    // convention. A custom entry's `name` is the connector ID itself, so
    // stripping the suffix reported `my-agent` as `my` — and then neither an
    // `--enabled my-agent` token nor a `.connectors/config.yaml` key spelled
    // `my-agent` matched it.
    registerAgent(makeManifest({ name: "my-agent", origin: "custom" }));
    const ids = registeredAgentIds();
    expect(ids.has("my-agent")).toBe(true);
    expect(ids.has("my")).toBe(false);
  });

  it("keeps a wiki-<x>-agent name intact when <x> is not a builtin", () => {
    // Regression (Codex P2). The `wiki-<id>-agent` unwrap exists so a builtin
    // OVERRIDE keeps the builtin's ID — `wiki-gitlab-agent` must stay `gitlab`
    // or an already-enabled `gitlab` key stops matching. A custom connector
    // that merely happens to be spelled that way overrides nothing, so
    // stripping `wiki-search-agent` to `search` made its own
    // `.connectors/config.yaml` key unreachable and atlas reported it
    // unconfigured. The scaffolded config already promises builtin-only
    // unwrap (init_wiki.ts:163); this is the code catching up to it.
    registerAgent(makeManifest({ name: "wiki-search-agent", origin: "custom" }));
    const ids = registeredAgentIds();
    expect(ids.has("wiki-search-agent")).toBe(true);
    expect(ids.has("search")).toBe(false);
  });

  it("still unwraps a builtin override to the builtin ID", () => {
    // The other half of the same rule: overriding a builtin MUST keep the
    // builtin's short ID, which is the entire reason the unwrap exists.
    registerAgent(makeManifest({ name: "wiki-gitlab-agent", origin: "custom" }));
    const ids = registeredAgentIds();
    expect(ids.has("gitlab")).toBe(true);
    expect(ids.has("wiki-gitlab-agent")).toBe(false);
  });

  it("keeps a custom name that starts with wiki- intact", () => {
    registerAgent(makeManifest({ name: "wiki-search", origin: "custom" }));
    const ids = registeredAgentIds();
    expect(ids.has("wiki-search")).toBe(true);
    expect(ids.has("search")).toBe(false);
  });

  it("lowercases derived IDs so case-insensitive consumers match", () => {
    // Regression (Codex P2): the validator accepts a mixed-case `name`, but
    // `how_to_go_deeper.parseEnabled` lowercases every `--enabled` token and
    // `.connectors/config.yaml` IDs are lowercase, so a literal `Stripe`
    // never matched and the source rendered an enable-the-connector prompt.
    registerAgent(makeManifest({ name: "Stripe", origin: "custom" }));
    const ids = registeredAgentIds();
    expect(ids.has("stripe")).toBe(true);
    expect(ids.has("Stripe")).toBe(false);
  });

  it("still unwraps the wiki-<id>-agent convention for builtins", () => {
    registerAgent(makeManifest({ name: "wiki-jira-agent", origin: "builtin" }));
    expect(registeredAgentIds().has("jira")).toBe(true);
  });

  it("keeps the builtin ID when a custom entry overrides a builtin", () => {
    // Regression (Codex P2): `docs/connectors.md` documents overriding a
    // builtin by reusing its name under `ecosystem.agents.custom` — the
    // self-hosted GitLab and GitHub Enterprise recipe. That entry registers
    // with origin "custom" and REPLACES the builtin (`registerAgent` is a
    // `Map.set` keyed on name), so keying the unwrap on origin reported it
    // as `wiki-gitlab-agent` and an already-enabled `gitlab` stopped
    // matching. The unwrap follows the NAME convention, not the origin.
    registerAgent(makeManifest({ name: "wiki-gitlab-agent", origin: "custom" }));
    const ids = registeredAgentIds();
    expect(ids.has("gitlab")).toBe(true);
    expect(ids.has("wiki-gitlab-agent")).toBe(false);
  });

  it("does not unwrap a half-convention custom name", () => {
    // Both affixes are required. `my-agent` has the suffix but not the
    // prefix; `wiki-search` has the prefix but not the suffix. Neither is
    // the builtin convention, so both stay literal.
    registerAgent(makeManifest({ name: "my-agent", origin: "custom" }));
    registerAgent(makeManifest({ name: "wiki-search", origin: "custom" }));
    const ids = registeredAgentIds();
    expect(ids.has("my-agent")).toBe(true);
    expect(ids.has("wiki-search")).toBe(true);
    expect(ids.has("my")).toBe(false);
    expect(ids.has("search")).toBe(false);
  });

  it("recognizes the convention regardless of the name's case", () => {
    // Regression (Codex P2, round 4): the convention regex ran BEFORE the
    // lowercasing, so a mixed-case `Wiki-GitLab-Agent` missed the pattern and
    // fell through to the literal branch, deriving `wiki-gitlab-agent` instead
    // of `gitlab` — measured. Case-folding first makes the two steps
    // order-independent.
    registerAgent(makeManifest({ name: "Wiki-GitLab-Agent", origin: "custom" }));
    const ids = registeredAgentIds();
    expect(ids.has("gitlab")).toBe(true);
    expect(ids.has("wiki-gitlab-agent")).toBe(false);
  });

  it("does not unwrap a name with nothing between the affixes", () => {
    registerAgent(makeManifest({ name: "wiki--agent", origin: "custom" }));
    expect(registeredAgentIds().has("wiki--agent")).toBe(true);
    expect(registeredAgentIds().has("")).toBe(false);
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

  it("rejects http:// and https:// as source_schemes", () => {
    // Regression (Codex P2): `lookupBySource` routes every `http(s)://` input
    // through its URL-pattern branch and returns null from there — the scheme
    // matcher below it is unreachable for those two. Measured: an entry
    // declaring `source_schemes: ["https://"]` never matched
    // `https://kb.example.com/article-1`, while the same shape with `kb://`
    // matched. Accepting them registered a connector that cannot fire, which
    // is the same failure the "kb" and "my_kb://" rejections above prevent.
    const p = writeConfigYaml(tmpDir, configWithCustom([
      { name: "ok", source_schemes: ["kb://"] },
      { name: "bad-https", source_schemes: ["https://"] },
      { name: "bad-http", source_schemes: ["http://"] },
      { name: "bad-mixed", source_schemes: ["kb://", "HTTPS://"] },
    ]));
    const configs = loadCustomAgentConfigs(p);
    expect(configs.map((c) => c.name)).toEqual(["ok"]);
    expect(stderrSpy).toHaveBeenCalled();
  });

  it("still accepts schemes that merely start with http", () => {
    // Only the two exact schemes are unroutable; `https-proxy://` is a
    // perfectly ordinary custom scheme and must not be caught by the guard.
    const p = writeConfigYaml(tmpDir, configWithCustom([
      { name: "proxy", source_schemes: ["https-proxy://"] },
      { name: "httpish", source_schemes: ["httpx://"] },
    ]));
    const configs = loadCustomAgentConfigs(p);
    expect(configs.map((c) => c.name)).toEqual(["proxy", "httpish"]);
  });

  it("rejects url-pattern constraints that URL matching can never satisfy", () => {
    // Regression (Codex P2) generalized across the whole class. `lookupBySource`
    // compares `path_prefix` against `URL.pathname` (always leading-slash) and
    // `hostname` against `URL.hostname` (bare host — no scheme, path or port).
    // Measured against https://kb.example.com/api/v1/doc-1:
    //   path_prefix "/api/"        -> MATCH
    //   path_prefix "api/"         -> no match
    //   hostname "https://kb…"     -> no match
    //   hostname "kb.example.com/api" -> no match
    //   hostname "kb.example.com:443" -> no match
    // `path_contains` is unconstrained — any substring is legitimately
    // matchable, so "api/" is fine there.
    const p = writeConfigYaml(tmpDir, configWithCustom([
      { name: "ok", source_url_patterns: [{ hostname: "kb.example.com", path_prefix: "/api/" }] },
      { name: "ok-contains", source_url_patterns: [{ hostname: "kb.example.com", path_contains: "api/" }] },
      { name: "bad-prefix-no-slash", source_url_patterns: [{ hostname: "kb.example.com", path_prefix: "api/" }] },
      { name: "bad-host-scheme", source_url_patterns: [{ hostname: "https://kb.example.com" }] },
      { name: "bad-host-path", source_url_patterns: [{ hostname: "kb.example.com/api" }] },
      { name: "bad-host-port", source_url_patterns: [{ hostname: "kb.example.com:443" }] },
    ]));
    const configs = loadCustomAgentConfigs(p);
    expect(configs.map((c) => c.name)).toEqual(["ok", "ok-contains"]);
    expect(stderrSpy).toHaveBeenCalled();
  });

  it("keeps accepting the wildcard hostname form", () => {
    // `matchHostname` supports a leading `*.`, so the guard must not treat
    // the `*` as an illegal host character.
    const p = writeConfigYaml(tmpDir, configWithCustom([
      { name: "wild", source_url_patterns: [{ hostname: "*.gitlab.com" }] },
    ]));
    expect(loadCustomAgentConfigs(p).map((c) => c.name)).toEqual(["wild"]);
  });

  it("rejects every wildcard placement other than a single leading `*.`", () => {
    // Regression (Codex P2). `matchHostname` (source_registry.ts:268) branches
    // only on `pattern.startsWith("*.")`; anything else falls through to
    // `pattern === hostname`, and a parsed `URL.hostname` never contains a
    // literal `*`. So these all register and then match nothing — the same
    // silent dead end the scheme/path/port shapes above already warn about.
    const p = writeConfigYaml(tmpDir, configWithCustom([
      { name: "ok-wild", source_url_patterns: [{ hostname: "*.gitlab.com" }] },
      { name: "ok-plain", source_url_patterns: [{ hostname: "gitlab.com" }] },
      { name: "bad-suffix-star", source_url_patterns: [{ hostname: "*example.com" }] },
      { name: "bad-infix-star", source_url_patterns: [{ hostname: "api.*.com" }] },
      { name: "bad-double-star", source_url_patterns: [{ hostname: "*.*.example.com" }] },
      { name: "bad-bare-star", source_url_patterns: [{ hostname: "*" }] },
      { name: "bad-star-dot-only", source_url_patterns: [{ hostname: "*." }] },
      { name: "bad-star-mid-label", source_url_patterns: [{ hostname: "a*.example.com" }] },
    ]));
    const configs = loadCustomAgentConfigs(p);
    expect(configs.map((c) => c.name)).toEqual(["ok-wild", "ok-plain"]);
    expect(stderrSpy).toHaveBeenCalled();
  });

  it("rejects a url pattern whose path_prefix/path_contains is not a string", () => {
    // `path_prefix: false` used to pass validation, and `lookupBySource` then
    // treated it as absent — widening the entry to a hostname-wide match
    // instead of skipping it.
    const p = writeConfigYaml(tmpDir, configWithCustom([
      { name: "ok", source_url_patterns: [{ hostname: "a.example.com", path_prefix: "/x/" }] },
      { name: "bad-prefix", source_url_patterns: [{ hostname: "b.example.com", path_prefix: false }] },
      { name: "bad-contains", source_url_patterns: [{ hostname: "c.example.com", path_contains: 7 }] },
    ]));
    const configs = loadCustomAgentConfigs(p);
    expect(configs.map((c) => c.name)).toEqual(["ok"]);
    expect(stderrSpy).toHaveBeenCalled();
  });

  it("rejects a url pattern whose path_prefix/path_contains is an empty string", () => {
    // An empty string is as falsy as `false`: `lookupBySource` skips it in the
    // path-constrained pass, and `if (p.path_prefix || p.path_contains)
    // continue` fails to skip it in the hostname pass — so the entry captures
    // every URL on the host.
    const p = writeConfigYaml(tmpDir, configWithCustom([
      { name: "ok", source_url_patterns: [{ hostname: "a.example.com", path_prefix: "/x/" }] },
      { name: "empty-prefix", source_url_patterns: [{ hostname: "b.example.com", path_prefix: "" }] },
      { name: "empty-contains", source_url_patterns: [{ hostname: "c.example.com", path_contains: "" }] },
      { name: "blank-prefix", source_url_patterns: [{ hostname: "d.example.com", path_prefix: "   " }] },
      { name: "padded-prefix", source_url_patterns: [{ hostname: "e.example.com", path_prefix: " /v1" }] },
    ]));
    const configs = loadCustomAgentConfigs(p);
    expect(configs.map((c) => c.name)).toEqual(["ok"]);
    expect(stderrSpy).toHaveBeenCalled();
  });

  it("rejects a name with leading or trailing whitespace", () => {
    // `" stripe "` passes the non-empty check but is stored verbatim, so every
    // ID derivation yields the padded form and a credentials key spelled
    // `stripe` never matches it.
    const p = writeConfigYaml(tmpDir, configWithCustom([
      { name: "stripe", source_schemes: ["stripe://"] },
      { name: " padded ", source_schemes: ["padded://"] },
    ]));
    const configs = loadCustomAgentConfigs(p);
    expect(configs.map((c) => c.name)).toEqual(["stripe"]);
    expect(stderrSpy).toHaveBeenCalled();
  });

  it("rejects a url pattern whose hostname is an empty string", () => {
    // `matchHostname` compares against `URL.hostname`, which is never empty
    // for an http(s) URL — so the pattern matches nothing and the entry is
    // silently dead rather than reported as malformed.
    const p = writeConfigYaml(tmpDir, configWithCustom([
      { name: "ok", source_url_patterns: [{ hostname: "a.example.com" }] },
      { name: "empty-host", source_url_patterns: [{ hostname: "" }] },
      { name: "blank-host", source_url_patterns: [{ hostname: "   " }] },
      { name: "padded-host", source_url_patterns: [{ hostname: " api.example.com " }] },
    ]));
    const configs = loadCustomAgentConfigs(p);
    expect(configs.map((c) => c.name)).toEqual(["ok"]);
    expect(stderrSpy).toHaveBeenCalled();
  });

  it("rejects an invocation_template with a non-string member", () => {
    // A mapping check alone let `label: false` through, and the renderer
    // interpolates the label directly — emitting `- **false:**` into the wiki.
    const p = writeConfigYaml(tmpDir, configWithCustom([
      { name: "ok", invocation_template: { label: "Knowledge Base" } },
      { name: "bad-label", invocation_template: { label: false } },
      { name: "bad-subagent", invocation_template: { subagent_type: 7 } },
      { name: "bad-model", invocation_template: { default_model: ["haiku"] } },
      // `customConfigToManifest` fills these with `?? <default>`, which does
      // not fire on "" — so an empty label renders as `- **:**`.
      { name: "empty-label", invocation_template: { label: "" } },
      { name: "empty-subagent", invocation_template: { subagent_type: "" } },
      { name: "empty-model", invocation_template: { default_model: "" } },
      { name: "blank-label", invocation_template: { label: "   " } },
      { name: "padded-label", invocation_template: { label: " Jira " } },
    ]));
    const configs = loadCustomAgentConfigs(p);
    expect(configs.map((c) => c.name)).toEqual(["ok"]);
    expect(stderrSpy).toHaveBeenCalled();
  });

  it("accepts a url pattern with only a hostname", () => {
    const p = writeConfigYaml(tmpDir, configWithCustom([
      { name: "host-only", source_url_patterns: [{ hostname: "d.example.com" }] },
    ]));
    expect(loadCustomAgentConfigs(p).map((c) => c.name)).toEqual(["host-only"]);
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
    // And it is still addressed as `gitlab`. This assertion is the one that
    // was missing: the override classified correctly all along, so a
    // derivation keyed on `origin` broke the connector ID without failing
    // any test above.
    expect(registeredAgentIds().has("gitlab")).toBe(true);
    expect(registeredAgentIds().has("wiki-gitlab-agent")).toBe(false);
  });

  it("falls back to builtins-only when no config exists", () => {
    initRegistryFromConfig(path.join(tmpDir, "missing.yaml"));
    expect(listAgents()).toHaveLength(9);
    expect(lookupBySource("kb://article-42")).toBeNull();
  });
});

// ── resolveWikiConfigPath ─────────────────────────────────────────────

describe("ensureRegistryForConfig — cache invalidation", () => {
  let tmpDir: string;
  let cfgPath: string;

  beforeEach(() => {
    _resetRegistryConfigState();
    tmpDir = makeTmpPath("registry-cache-");
    cfgPath = writeConfigYaml(tmpDir, {
      wiki: { name: "test-wiki" },
      ecosystem: {
        agents: {
          custom: [{ name: "my-kb", source_schemes: ["kb://"] }],
        },
      },
    });
    ensureRegistryForConfig(cfgPath);
  });

  afterEach(() => {
    cleanupTmpPath(tmpDir);
    clearRegistry();
    _resetRegistryConfigState();
  });

  // Regression (Codex P2). `_registryLoaded`/`_loadedConfigPath` assert that
  // `_agents` holds at least the agents of that config. Every mutation that
  // can REMOVE an agent falsifies the claim, and `ensureRegistryForConfig`
  // would then early-return on the same path and classify against a registry
  // that no longer holds the config — permanently, since nothing else resets
  // the flags. Measured: clearRegistry lost builtins *and* custom agents,
  // initRegistry lost custom agents, unregisterAgent lost the named one.

  it("reloads the config after clearRegistry emptied the registry", () => {
    clearRegistry();
    ensureRegistryForConfig(cfgPath);
    expect(lookupBySource("kb://a")?.name).toBe("my-kb");
    expect(lookupBySource("jira://AUTH-1")?.name).toBe("wiki-jira-agent");
  });

  it("reloads the config after initRegistry replaced the registry", () => {
    initRegistry();
    ensureRegistryForConfig(cfgPath);
    expect(lookupBySource("kb://a")?.name).toBe("my-kb");
  });

  it("reloads the config after unregisterAgent removed a builtin", () => {
    unregisterAgent("wiki-jira-agent");
    ensureRegistryForConfig(cfgPath);
    expect(lookupBySource("jira://AUTH-1")?.name).toBe("wiki-jira-agent");
  });

  it("does not reload — and so does not drop — an agent added by registerAgent", () => {
    // The rule is one-sided on purpose. Adding keeps the claim true (the map
    // is a superset), so `registerAgent` must NOT invalidate: doing so would
    // reload the config on the next classify and throw away the caller's
    // registration.
    registerAgent(makeManifest({ name: "adhoc", source_schemes: ["adhoc://"] }));
    ensureRegistryForConfig(cfgPath);
    expect(lookupBySource("adhoc://a")?.name).toBe("adhoc");
    expect(lookupBySource("kb://a")?.name).toBe("my-kb");
  });
});

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
