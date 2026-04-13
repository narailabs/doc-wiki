/**
 * Tests for github_fetch and GithubClient.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetch, VALID_ACTIONS } from "../github_fetch.js";
import {
  GithubClient,
  type GithubClientOptions,
} from "../lib/github_client.js";

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
  overrides: Partial<GithubClientOptions> = {},
  fetchMock?: (url: string, init?: RequestInit) => Promise<Response>,
): GithubClient {
  return new GithubClient({
    token: "ghp_test",
    rateLimitPerMin: 100,
    connectTimeoutMs: 50,
    readTimeoutMs: 50,
    fetchImpl: fetchMock
      ? (async (url, init) => fetchMock(String(url), init))
      : undefined,
    sleepImpl: async () => {},
    ...overrides,
  });
}

describe("GithubClient", () => {
  afterEach(() => vi.restoreAllMocks());

  it("attaches Bearer + API-version headers", async () => {
    let headers: Headers | undefined;
    const client = makeClient({}, async (_url, init) => {
      headers = new Headers(init?.headers as HeadersInit);
      return jsonResponse({ full_name: "a/b" });
    });
    await client.getRepo("a", "b");
    expect(headers?.get("authorization")).toBe("Bearer ghp_test");
    expect(headers?.get("x-github-api-version")).toBe("2022-11-28");
  });

  it("composes search_code query with repo qualifier", async () => {
    let called = "";
    const client = makeClient({}, async (url) => {
      called = url;
      return jsonResponse({ total_count: 0, items: [] });
    });
    await client.searchCode("foo", "bar", "class Auth");
    expect(called).toMatch(/q=class\+Auth\+repo%3Afoo%2Fbar/);
  });

  it("retries on primary rate limit then succeeds", async () => {
    let calls = 0;
    const client = makeClient({}, async () => {
      calls++;
      if (calls === 1) {
        return jsonResponse(
          {},
          {
            status: 403,
            headers: { "x-ratelimit-remaining": "0", "retry-after": "0" },
          },
        );
      }
      return jsonResponse({ full_name: "a/b" });
    });
    const r = await client.getRepo("a", "b");
    expect(calls).toBe(2);
    expect(r.ok).toBe(true);
  });

  it("surfaces 404 as NOT_FOUND non-retriable", async () => {
    const client = makeClient({}, async () =>
      jsonResponse({ message: "missing" }, { status: 404 }),
    );
    const r = await client.getRepo("a", "b");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("NOT_FOUND");
      expect(r.retriable).toBe(false);
    }
  });

  it("graphql posts JSON body to /graphql endpoint", async () => {
    let calledUrl = "";
    let bodyStr = "";
    const client = makeClient({}, async (url, init) => {
      calledUrl = url;
      bodyStr = String(init?.body ?? "");
      return jsonResponse({
        data: { repository: { hasWikiEnabled: true } },
      });
    });
    const r = await client.listWikiPages("foo", "bar");
    expect(calledUrl).toMatch(/\/graphql$/);
    expect(bodyStr).toMatch(/hasWikiEnabled/);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.hasWikiEnabled).toBe(true);
  });
});

describe("github_fetch.fetch", () => {
  beforeEach(() => {
    delete process.env["GITHUB_TOKEN"];
  });
  afterEach(() => vi.restoreAllMocks());

  it("VALID_ACTIONS set", () => {
    expect([...VALID_ACTIONS].sort()).toEqual([
      "get_file",
      "get_issues",
      "get_pulls",
      "repo_info",
      "search_code",
    ]);
  });

  it("rejects invalid owner", async () => {
    const r = await fetch("repo_info", { owner: "bad/owner", repo: "r" });
    expect(r["error_code"]).toBe("VALIDATION_ERROR");
  });

  it("returns CONFIG_ERROR when GITHUB_TOKEN missing", async () => {
    const r = await fetch("repo_info", { owner: "acme", repo: "backend" });
    expect(r["status"]).toBe("error");
    expect(r["error_code"]).toBe("CONFIG_ERROR");
    expect(r["retriable"]).toBe(false);
    expect(r["message"]).toContain("GITHUB_TOKEN");
  });

  it("decodes base64 file content via injected client", async () => {
    const client = makeClient({}, async () =>
      jsonResponse({
        path: "README.md",
        size: 5,
        encoding: "base64",
        content: Buffer.from("hello", "utf-8").toString("base64"),
      }),
    );
    const r = await fetch(
      "get_file",
      { owner: "a", repo: "b", path: "README.md" },
      { client },
    );
    expect(r["status"]).toBe("success");
    expect((r["data"] as Record<string, unknown>)["content"]).toBe("hello");
  });

  it("rejects path traversal", async () => {
    const r = await fetch("get_file", {
      owner: "a",
      repo: "b",
      path: "../etc/passwd",
    });
    expect(r["error_code"]).toBe("VALIDATION_ERROR");
  });
});
