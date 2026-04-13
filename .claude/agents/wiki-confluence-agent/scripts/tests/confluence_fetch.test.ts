/**
 * Tests for confluence_fetch and ConfluenceClient.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetch, VALID_ACTIONS } from "../confluence_fetch.js";
import {
  ConfluenceClient,
  type ConfluenceClientOptions,
} from "../lib/confluence_client.js";

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
  overrides: Partial<ConfluenceClientOptions> = {},
  fetchMock?: (url: string, init?: RequestInit) => Promise<Response>,
): ConfluenceClient {
  return new ConfluenceClient({
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
  });
}

describe("ConfluenceClient", () => {
  afterEach(() => vi.restoreAllMocks());

  it("attaches Basic auth header", async () => {
    let headers: Headers | undefined;
    const client = makeClient({}, async (_url, init) => {
      headers = new Headers(init?.headers as HeadersInit);
      return jsonResponse({ results: [], totalSize: 0 });
    });
    await client.searchCql("space = DEV", 10);
    expect(headers?.get("authorization")).toMatch(/^Basic /);
  });

  it("expands body.storage on getContent by default", async () => {
    let calledUrl = "";
    const client = makeClient({}, async (url) => {
      calledUrl = url;
      return jsonResponse({
        id: "1",
        title: "t",
        body: { storage: { value: "<p>hi</p>" } },
        space: { key: "DEV" },
        version: { number: 3 },
      });
    });
    const res = await client.getContent("1");
    expect(calledUrl).toMatch(/expand=body\.storage/);
    expect(res.ok).toBe(true);
  });

  it("rejects unknown HTTP methods", async () => {
    const client = makeClient();
    const res = await client.request("DELETE" as never, "/wiki/rest/api/space/DEV");
    expect(res).toEqual(
      expect.objectContaining({ ok: false, code: "METHOD_NOT_ALLOWED" }),
    );
  });

  it("retries on 503 and surfaces final error after retries exhausted", async () => {
    let calls = 0;
    const client = makeClient({}, async () => {
      calls++;
      return jsonResponse({}, { status: 503 });
    });
    const res = await client.searchCql("x", 10);
    expect(calls).toBe(4);
    expect(res.ok).toBe(false);
  });
});

describe("confluence_fetch.fetch", () => {
  beforeEach(() => {
    delete process.env["CONFLUENCE_SITE_URL"];
    delete process.env["CONFLUENCE_EMAIL"];
    delete process.env["CONFLUENCE_API_TOKEN"];
  });
  afterEach(() => vi.restoreAllMocks());

  it("exposes VALID_ACTIONS", () => {
    expect([...VALID_ACTIONS].sort()).toEqual([
      "cql_search",
      "get_page",
      "get_space",
    ]);
  });

  it("rejects unknown action", async () => {
    const r = await fetch("nope", {});
    expect(r["error_code"]).toBe("VALIDATION_ERROR");
  });

  it("validates page_id format", async () => {
    const r = await fetch("get_page", { page_id: "not-numeric" });
    expect(r["error_code"]).toBe("VALIDATION_ERROR");
  });

  it("returns CONFIG_ERROR when credentials missing", async () => {
    const r = await fetch("get_space", { space_key: "DEV" });
    expect(r["status"]).toBe("error");
    expect(r["error_code"]).toBe("CONFIG_ERROR");
    expect(r["retriable"]).toBe(false);
    expect(r["message"]).toContain("CONFLUENCE_");
  });

  it("reshapes cql_search with injected client", async () => {
    const client = makeClient({}, async () =>
      jsonResponse({
        totalSize: 1,
        size: 1,
        results: [
          {
            id: "42",
            title: "Hello",
            space: { key: "DEV" },
            version: { number: 2, when: "2026-04-01T00:00:00Z" },
          },
        ],
      }),
    );
    const r = await fetch(
      "cql_search",
      { cql: "space = DEV", max_results: 5 },
      { client },
    );
    expect(r["status"]).toBe("success");
    const data = r["data"] as Record<string, unknown>;
    expect(data["total"]).toBe(1);
    expect((data["pages"] as Array<Record<string, unknown>>)[0]?.["title"]).toBe(
      "Hello",
    );
  });

  it("surfaces 401 as AUTH_ERROR", async () => {
    const client = makeClient({}, async () =>
      jsonResponse({}, { status: 401 }),
    );
    const r = await fetch(
      "get_page",
      { page_id: "123" },
      { client },
    );
    expect(r["error_code"]).toBe("AUTH_ERROR");
  });
});
