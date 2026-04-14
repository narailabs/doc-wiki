/**
 * Tests for jira_fetch and JiraClient. Uses `vi.spyOn(globalThis, 'fetch')`
 * to mock HTTP responses — no external HTTP library required.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetch, VALID_ACTIONS } from "../jira_fetch.js";
import {
  JiraClient,
  type JiraClientOptions,
} from "../lib/jira_client.js";

function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

function makeClient(
  overrides: Partial<JiraClientOptions> = {},
  fetchMock?: (url: string, init?: RequestInit) => Promise<Response>,
): JiraClient {
  const opts: JiraClientOptions = {
    siteUrl: "https://example.atlassian.net",
    email: "user@example.com",
    apiToken: "tok",
    rateLimitPerMin: 100,
    connectTimeoutMs: 50,
    readTimeoutMs: 50,
    fetchImpl: fetchMock
      ? (async (url, init) => fetchMock(String(url), init))
      : undefined,
    sleepImpl: async () => {},
    ...overrides,
  };
  return new JiraClient(opts);
}

describe("JiraClient", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects invalid site URLs at construction", () => {
    expect(() =>
      new JiraClient({
        siteUrl: "ftp://evil.example",
        email: "a",
        apiToken: "b",
      }),
    ).toThrow(/Invalid Jira site URL/);
  });

  it("builds URLs with query params and attaches Basic auth", async () => {
    const calls: Array<{ url: string; headers: Headers }> = [];
    const client = makeClient({}, async (url, init) => {
      calls.push({
        url,
        headers: new Headers(init?.headers as HeadersInit),
      });
      return jsonResponse({ total: 0, issues: [] });
    });
    const res = await client.searchJql("project = WIKI", 25, 0);
    expect(res.ok).toBe(true);
    expect(calls[0]?.url).toMatch(
      /https:\/\/example\.atlassian\.net\/rest\/api\/3\/search\?jql=project/,
    );
    expect(calls[0]?.headers.get("authorization")).toMatch(/^Basic /);
  });

  it("rejects non-GET methods", async () => {
    const client = makeClient();
    const res = await client.request("POST" as never, "/rest/api/3/search");
    expect(res).toEqual(
      expect.objectContaining({ ok: false, code: "METHOD_NOT_ALLOWED" }),
    );
  });

  it("retries on 429 and succeeds", async () => {
    let calls = 0;
    const client = makeClient({ rateLimitPerMin: 100 }, async () => {
      calls++;
      if (calls === 1) {
        return jsonResponse({}, { status: 429, headers: { "retry-after": "0" } });
      }
      return jsonResponse({ total: 1, issues: [{ key: "A-1" }] });
    });
    const res = await client.searchJql("x", 10);
    expect(calls).toBe(2);
    expect(res.ok).toBe(true);
  });

  it("surfaces 404 as NOT_FOUND and is non-retriable", async () => {
    const client = makeClient({}, async () =>
      jsonResponse({ error: "missing" }, { status: 404 }),
    );
    const res = await client.getIssue("AAA-1");
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("NOT_FOUND");
      expect(res.retriable).toBe(false);
    }
  });

  it("enforces rate limit via sleep", async () => {
    const sleeps: number[] = [];
    const client = makeClient(
      {
        rateLimitPerMin: 2,
        sleepImpl: async (ms) => {
          sleeps.push(ms);
        },
      },
      async () => jsonResponse({ total: 0, issues: [] }),
    );
    await client.searchJql("a", 1);
    await client.searchJql("b", 1);
    await client.searchJql("c", 1);
    // Third call should have triggered a rate-limit wait.
    expect(sleeps.some((s) => s > 0)).toBe(true);
  });
});

describe("jira_fetch.fetch", () => {
  beforeEach(() => {
    delete process.env["JIRA_SITE_URL"];
    delete process.env["JIRA_EMAIL"];
    delete process.env["JIRA_API_TOKEN"];
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("VALID_ACTIONS set", () => {
    expect([...VALID_ACTIONS].sort()).toEqual([
      "get_issue",
      "get_project",
      "jql_search",
    ]);
  });

  it("returns VALIDATION_ERROR for unknown action", async () => {
    const r = await fetch("nope", {});
    expect(r["status"]).toBe("error");
    expect(r["error_code"]).toBe("VALIDATION_ERROR");
  });

  it("returns VALIDATION_ERROR when missing params", async () => {
    const r = await fetch("jql_search", {});
    expect(r["error_code"]).toBe("VALIDATION_ERROR");
  });

  it("returns CONFIG_ERROR when no credentials configured", async () => {
    const r = await fetch("jql_search", { jql: "project = WIKI" });
    expect(r["status"]).toBe("error");
    expect(r["error_code"]).toBe("CONFIG_ERROR");
    expect(r["retriable"]).toBe(false);
    expect(r["message"]).toContain("JIRA_");
  });

  it("invokes injected client and reshapes response", async () => {
    const client = makeClient({}, async () =>
      jsonResponse({
        total: 2,
        issues: [
          {
            key: "FOO-1",
            fields: {
              summary: "hello",
              status: { name: "Open" },
              assignee: { displayName: "Jane" },
              labels: ["a"],
              updated: "2026-04-01",
            },
          },
        ],
      }),
    );
    const r = await fetch(
      "jql_search",
      { jql: "project = FOO", max_results: 10 },
      { client },
    );
    expect(r["status"]).toBe("success");
    const data = r["data"] as Record<string, unknown>;
    expect(data["total"]).toBe(2);
    const first = (data["issues"] as Array<Record<string, unknown>>)[0];
    expect(first?.["key"]).toBe("FOO-1");
    expect(first?.["assignee"]).toBe("Jane");
  });

  it("surfaces client errors as structured payloads", async () => {
    const client = makeClient({}, async () =>
      jsonResponse({}, { status: 401 }),
    );
    const r = await fetch(
      "get_project",
      { project_key: "FOO" },
      { client },
    );
    expect(r["status"]).toBe("error");
    expect(r["error_code"]).toBe("AUTH_ERROR");
  });
});

// ======================================================================
// G-AGENT-MERMAID: mermaid field contract (v2 §6)
// ======================================================================

describe("jira_fetch mermaid output (G-AGENT-MERMAID)", () => {
  it("jql_search emits graph TB grouping issues by status", async () => {
    const client = makeClient({}, async () =>
      jsonResponse({
        total: 3,
        issues: [
          {
            key: "FOO-1",
            fields: { summary: "fix login", status: { name: "Done" } },
          },
          {
            key: "FOO-2",
            fields: { summary: "add search", status: { name: "In Progress" } },
          },
          {
            key: "FOO-3",
            fields: { summary: "rename", status: { name: "Done" } },
          },
        ],
      }),
    );
    const r = await fetch("jql_search", { jql: "project = FOO" }, { client });
    expect(r["status"]).toBe("success");
    const m = r["mermaid"] as Record<string, string> | undefined;
    expect(m).toBeDefined();
    expect(m?.type).toBe("graph TB");
    expect(m?.code).toContain("Issues");
    expect(m?.code).toContain("Done");
    expect(m?.code).toContain("In Progress");
    expect(m?.code).toContain("FOO-1");
    expect(m?.code).toContain("FOO-2");
    expect(m?.code).toContain("FOO-3");
  });

  it("jql_search with no issues omits mermaid", async () => {
    const client = makeClient({}, async () =>
      jsonResponse({ total: 0, issues: [] }),
    );
    const r = await fetch("jql_search", { jql: "project = NONE" }, { client });
    expect(r["status"]).toBe("success");
    expect(r["mermaid"]).toBeUndefined();
  });

  it("get_issue omits mermaid (single record)", async () => {
    const client = makeClient({}, async () =>
      jsonResponse({
        key: "FOO-1",
        fields: { summary: "x", status: { name: "Open" } },
      }),
    );
    const r = await fetch("get_issue", { issue_key: "FOO-1" }, { client });
    expect(r["status"]).toBe("success");
    expect(r["mermaid"]).toBeUndefined();
  });

  it("get_project omits mermaid", async () => {
    const client = makeClient({}, async () =>
      jsonResponse({
        key: "FOO",
        name: "Foo",
        description: "",
        lead: { displayName: "Jane" },
        issueTypes: [],
      }),
    );
    const r = await fetch("get_project", { project_key: "FOO" }, { client });
    expect(r["status"]).toBe("success");
    expect(r["mermaid"]).toBeUndefined();
  });
});
