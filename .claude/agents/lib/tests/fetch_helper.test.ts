/**
 * Tests for fetch_helper.ts — size + timeout caps on outgoing HTTP.
 *
 * We mock `globalThis.fetch` rather than standing up a real server so the
 * suite stays deterministic and offline-safe.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

import {
  FETCH_MAX_BYTES_DEFAULT,
  FETCH_TIMEOUT_MS_DEFAULT,
  FetchCapExceeded,
  fetchWithCaps,
} from "../fetch_helper.js";

describe("defaults", () => {
  it("uses 50 MB and 60 s by default", () => {
    expect(FETCH_MAX_BYTES_DEFAULT).toBe(50 * 1024 * 1024);
    expect(FETCH_TIMEOUT_MS_DEFAULT).toBe(60_000);
  });
});

describe("fetchWithCaps", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function mockFetchWithBody(body: Uint8Array, headers: Record<string, string> = {}): void {
    globalThis.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      // Simulate an aborted fetch when the signal is already aborted
      if (init?.signal?.aborted) {
        throw new Error("aborted");
      }
      return new Response(body, { status: 200, headers });
    }) as unknown as typeof globalThis.fetch;
  }

  it("returns the response body when it fits under the cap", async () => {
    const body = new Uint8Array([1, 2, 3, 4]);
    mockFetchWithBody(body);
    const res = await fetchWithCaps("https://example.com/tiny", {}, { maxBytes: 16 });
    const buf = new Uint8Array(await res.arrayBuffer());
    expect([...buf]).toEqual([1, 2, 3, 4]);
  });

  it("throws FetchCapExceeded when content-length exceeds the cap", async () => {
    const body = new Uint8Array(256);
    mockFetchWithBody(body, { "content-length": "10485760" }); // 10 MB advertised
    await expect(
      fetchWithCaps("https://example.com/big", {}, { maxBytes: 100 }),
    ).rejects.toBeInstanceOf(FetchCapExceeded);
  });

  it("throws FetchCapExceeded when streamed bytes exceed the cap", async () => {
    // content-length omitted — the cap must be enforced while streaming.
    const body = new Uint8Array(2048);
    mockFetchWithBody(body);
    await expect(
      fetchWithCaps("https://example.com/stream", {}, { maxBytes: 512 }),
    ).rejects.toBeInstanceOf(FetchCapExceeded);
  });

  it("aborts when the timeout fires before fetch settles", async () => {
    globalThis.fetch = vi.fn((_: unknown, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(init.signal?.reason ?? new Error("aborted"));
        });
      });
    }) as unknown as typeof globalThis.fetch;
    await expect(
      fetchWithCaps("https://example.com/slow", {}, { timeoutMs: 10 }),
    ).rejects.toThrow();
  });

  it("composes an external AbortSignal with the internal timeout", async () => {
    const ctl = new AbortController();
    globalThis.fetch = vi.fn((_: unknown, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(init.signal?.reason ?? new Error("aborted"));
        });
      });
    }) as unknown as typeof globalThis.fetch;
    const p = fetchWithCaps("https://example.com/slow", {}, {
      timeoutMs: 60_000,
      signal: ctl.signal,
    });
    ctl.abort(new Error("caller cancelled"));
    await expect(p).rejects.toThrow();
  });

  it("works on responses with no body (HEAD-like)", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(null, { status: 204 }),
    ) as unknown as typeof globalThis.fetch;
    const res = await fetchWithCaps("https://example.com/nobody");
    expect(res.status).toBe(204);
  });
});
