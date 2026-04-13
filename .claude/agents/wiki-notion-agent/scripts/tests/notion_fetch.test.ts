/**
 * Tests for notion_fetch and NotionClient.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetch, VALID_ACTIONS } from "../notion_fetch.js";
import {
  NotionClient,
  type NotionClientOptions,
} from "../lib/notion_client.js";

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
  overrides: Partial<NotionClientOptions> = {},
  fetchMock?: (url: string, init?: RequestInit) => Promise<Response>,
): NotionClient {
  return new NotionClient({
    token: "secret_test",
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

const SAMPLE_DB_ID = "a1b2c3d4e5f6789012345678901234ab";

describe("NotionClient", () => {
  afterEach(() => vi.restoreAllMocks());

  it("sends Notion-Version header", async () => {
    let headers: Headers | undefined;
    const client = makeClient({}, async (_url, init) => {
      headers = new Headers(init?.headers as HeadersInit);
      return jsonResponse({ results: [] });
    });
    await client.search("hello", undefined, 10);
    expect(headers?.get("notion-version")).toBe("2022-06-28");
    expect(headers?.get("authorization")).toBe("Bearer secret_test");
  });

  it("POST_READ_ONLY allowed on /v1/search", async () => {
    let called = "";
    let bodyStr = "";
    const client = makeClient({}, async (url, init) => {
      called = url;
      bodyStr = String(init?.body ?? "");
      return jsonResponse({ results: [] });
    });
    await client.search("hello", "page", 5);
    expect(called).toMatch(/\/v1\/search$/);
    expect(bodyStr).toMatch(/"filter":\{"property":"object","value":"page"\}/);
  });

  it("POST rejected on an unrelated path", async () => {
    const client = makeClient();
    const r = await client.request("POST_READ_ONLY" as never, "/v1/pages", {
      foo: 1,
    });
    expect(r).toEqual(
      expect.objectContaining({ ok: false, code: "METHOD_NOT_ALLOWED" }),
    );
  });

  it("database query uses POST_READ_ONLY", async () => {
    let method = "";
    const client = makeClient({}, async (_url, init) => {
      method = String(init?.method ?? "");
      return jsonResponse({ results: [] });
    });
    await client.queryDatabase(SAMPLE_DB_ID, null, 10);
    expect(method).toBe("POST");
  });
});

describe("notion_fetch.fetch", () => {
  beforeEach(() => {
    delete process.env["NOTION_TOKEN"];
  });
  afterEach(() => vi.restoreAllMocks());

  it("VALID_ACTIONS set", () => {
    expect([...VALID_ACTIONS].sort()).toEqual([
      "get_database",
      "get_page",
      "query_database",
      "search",
    ]);
  });

  it("rejects invalid UUID", async () => {
    const r = await fetch("get_page", { page_id: "not-a-uuid" });
    expect(r["error_code"]).toBe("VALIDATION_ERROR");
  });

  it("returns CONFIG_ERROR when NOTION_TOKEN missing", async () => {
    const r = await fetch("search", { query: "hello" });
    expect(r["status"]).toBe("error");
    expect(r["error_code"]).toBe("CONFIG_ERROR");
    expect(r["retriable"]).toBe(false);
    expect(r["message"]).toContain("NOTION_TOKEN");
  });

  it("extracts title via property shape", async () => {
    const client = makeClient({}, async () =>
      jsonResponse({
        id: SAMPLE_DB_ID,
        parent: { type: "workspace" },
        last_edited_time: "2026-04-01T00:00:00Z",
        properties: {
          Name: {
            type: "title",
            title: [{ plain_text: "Hello " }, { plain_text: "World" }],
          },
        },
      }),
    );
    const r = await fetch(
      "get_page",
      { page_id: SAMPLE_DB_ID },
      { client },
    );
    expect(r["status"]).toBe("success");
    expect((r["data"] as Record<string, unknown>)["title"]).toBe("Hello World");
  });

  it("surfaces 401 as AUTH_ERROR", async () => {
    const client = makeClient({}, async () =>
      jsonResponse({ error: "unauthorized" }, { status: 401 }),
    );
    const r = await fetch(
      "get_database",
      { database_id: SAMPLE_DB_ID },
      { client },
    );
    expect(r["error_code"]).toBe("AUTH_ERROR");
  });
});
