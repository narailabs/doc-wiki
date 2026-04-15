/**
 * jira_client.ts — read-only Atlassian Cloud REST v3 HTTP client.
 *
 * Design guarantees:
 * - Only GET is permitted (enforced via the `method` whitelist).
 * - Every outgoing URL is validated via `security_check.validateUrl`.
 * - Connect/read timeouts enforced via `AbortController` (10s / 30s).
 * - Exponential backoff honours `Retry-After` headers on 429/5xx.
 * - A best-effort 60-req/min ceiling is applied per client instance.
 * - Credentials resolved via `resolveSecret` with `env_var` fallback order.
 */
import { validateUrl } from "../../../lib/security_check.js";
import { resolveSecret } from "../../../lib/credential_providers/index.js";

type HttpMethod = "GET";
const ALLOWED_METHODS: ReadonlySet<HttpMethod> = new Set<HttpMethod>(["GET"]);

const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
const DEFAULT_READ_TIMEOUT_MS = 30_000;
const DEFAULT_RATE_LIMIT_PER_MIN = 60;
const MAX_ATTEMPTS = 4;

export interface JiraClientOptions {
  /** Atlassian Cloud site URL — e.g. https://acme.atlassian.net. */
  siteUrl: string;
  /** User email for Basic auth. */
  email: string;
  /** API token for Basic auth. */
  apiToken: string;
  /** Per-client request-per-minute ceiling. Default 60. */
  rateLimitPerMin?: number;
  /** Connect timeout ms. Default 10_000. */
  connectTimeoutMs?: number;
  /** Read timeout ms. Default 30_000. */
  readTimeoutMs?: number;
  /** Optional fetch-override used by unit tests. */
  fetchImpl?: typeof globalThis.fetch;
  /** Optional sleep-override used by unit tests. */
  sleepImpl?: (ms: number) => Promise<void>;
}

export interface JiraErrorPayload {
  ok: false;
  code: string;
  message: string;
  retriable: boolean;
  status?: number;
}

export interface JiraSuccessPayload<T> {
  ok: true;
  data: T;
  status: number;
}

export type JiraResult<T> = JiraSuccessPayload<T> | JiraErrorPayload;

/** Resolve Jira credentials from the shared credential provider chain. */
export async function loadJiraCredentials(): Promise<
  { siteUrl: string; email: string; apiToken: string } | null
> {
  const siteUrl = process.env["JIRA_SITE_URL"] ?? null;
  const email =
    (await resolveSecret("JIRA_EMAIL")) ??
    process.env["JIRA_EMAIL"] ??
    null;
  const apiToken =
    (await resolveSecret("JIRA_API_TOKEN")) ??
    process.env["JIRA_API_TOKEN"] ??
    null;
  if (!siteUrl || !email || !apiToken) return null;
  return { siteUrl, email, apiToken };
}

export class JiraClient {
  private readonly _site: string;
  private readonly _authHeader: string;
  private readonly _rateLimitPerMin: number;
  private readonly _connectTimeoutMs: number;
  private readonly _readTimeoutMs: number;
  private readonly _fetch: typeof globalThis.fetch;
  private readonly _sleep: (ms: number) => Promise<void>;
  private _requestTimestamps: number[] = [];

  constructor(opts: JiraClientOptions) {
    if (!validateUrl(opts.siteUrl)) {
      throw new Error(`Invalid Jira site URL: ${opts.siteUrl}`);
    }
    this._site = opts.siteUrl.replace(/\/+$/, "");
    const basic = Buffer.from(`${opts.email}:${opts.apiToken}`, "utf-8").toString(
      "base64",
    );
    this._authHeader = `Basic ${basic}`;
    this._rateLimitPerMin = opts.rateLimitPerMin ?? DEFAULT_RATE_LIMIT_PER_MIN;
    this._connectTimeoutMs = opts.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
    this._readTimeoutMs = opts.readTimeoutMs ?? DEFAULT_READ_TIMEOUT_MS;
    this._fetch = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this._sleep =
      opts.sleepImpl ??
      ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  }

  /** Reset the request-per-minute sliding window (test helper). */
  public resetRateLimiter(): void {
    this._requestTimestamps = [];
  }

  private async _throttle(): Promise<void> {
    const now = Date.now();
    const cutoff = now - 60_000;
    this._requestTimestamps = this._requestTimestamps.filter((t) => t > cutoff);
    if (this._requestTimestamps.length >= this._rateLimitPerMin) {
      const oldest = this._requestTimestamps[0] ?? now;
      const waitMs = Math.max(0, 60_000 - (now - oldest));
      if (waitMs > 0) await this._sleep(waitMs);
      this._requestTimestamps = this._requestTimestamps.filter(
        (t) => t > Date.now() - 60_000,
      );
    }
    this._requestTimestamps.push(Date.now());
  }

  /** Build a URL against the site root. */
  public buildUrl(path: string, query?: Record<string, unknown>): string {
    const relative = path.startsWith("/") ? path : `/${path}`;
    const base = `${this._site}${relative}`;
    if (!query) return base;
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null) continue;
      params.append(k, String(v));
    }
    const qs = params.toString();
    return qs ? `${base}?${qs}` : base;
  }

  public async request<T = unknown>(
    method: HttpMethod,
    path: string,
    init: { query?: Record<string, unknown>; headers?: Record<string, string> } = {},
  ): Promise<JiraResult<T>> {
    if (!ALLOWED_METHODS.has(method)) {
      return {
        ok: false,
        code: "METHOD_NOT_ALLOWED",
        message: `Method ${method} is not permitted`,
        retriable: false,
      };
    }
    const url = this.buildUrl(path, init.query);
    if (!validateUrl(url)) {
      return {
        ok: false,
        code: "INVALID_URL",
        message: `URL rejected: ${url}`,
        retriable: false,
      };
    }

    let lastError: JiraErrorPayload | null = null;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      await this._throttle();
      const connectCtrl = new AbortController();
      const readCtrl = new AbortController();
      const connectTimer = setTimeout(
        () => connectCtrl.abort(),
        this._connectTimeoutMs,
      );
      const readTimer = setTimeout(
        () => readCtrl.abort(),
        this._connectTimeoutMs + this._readTimeoutMs,
      );
      try {
        const response = await this._fetch(url, {
          method,
          headers: {
            Authorization: this._authHeader,
            Accept: "application/json",
            ...(init.headers ?? {}),
          },
          signal: readCtrl.signal,
        });
        clearTimeout(connectTimer);
        const status = response.status;

        if (status === 429 || status >= 500) {
          const retryAfter = parseRetryAfter(response.headers.get("retry-after"));
          const backoff =
            retryAfter ?? Math.min(30_000, 500 * 2 ** attempt);
          lastError = {
            ok: false,
            code: status === 429 ? "RATE_LIMITED" : "SERVER_ERROR",
            message: `Jira returned HTTP ${status}`,
            retriable: true,
            status,
          };
          if (attempt < MAX_ATTEMPTS - 1) {
            await this._sleep(backoff);
            continue;
          }
          return lastError;
        }

        if (!response.ok) {
          let bodyText = "";
          try {
            bodyText = await response.text();
          } catch {
            /* ignore */
          }
          return {
            ok: false,
            code: classifyHttpStatus(status),
            message: `Jira HTTP ${status}: ${truncate(bodyText, 200)}`,
            retriable: false,
            status,
          };
        }

        const data = (await response.json()) as T;
        return { ok: true, data, status };
      } catch (err) {
        clearTimeout(connectTimer);
        const message = err instanceof Error ? err.message : String(err);
        const aborted =
          err instanceof DOMException || /abort/i.test(message);
        lastError = {
          ok: false,
          code: aborted ? "TIMEOUT" : "NETWORK_ERROR",
          message: aborted ? "Request timed out" : message,
          retriable: true,
        };
        if (attempt < MAX_ATTEMPTS - 1) {
          await this._sleep(Math.min(30_000, 500 * 2 ** attempt));
          continue;
        }
        return lastError;
      } finally {
        clearTimeout(readTimer);
      }
    }
    return (
      lastError ?? {
        ok: false,
        code: "UNKNOWN",
        message: "Exhausted retries without a response",
        retriable: true,
      }
    );
  }

  /** JQL search. `/rest/api/3/search`. */
  public async searchJql(
    jql: string,
    maxResults: number,
    startAt = 0,
  ): Promise<JiraResult<JiraSearchResponse>> {
    return this.request<JiraSearchResponse>("GET", "/rest/api/3/search", {
      query: { jql, maxResults, startAt, fields: "summary,status,assignee,labels,updated" },
    });
  }

  /** `/rest/api/3/issue/{issueKey}`. */
  public async getIssue(
    issueKey: string,
    expand: string[] = [],
  ): Promise<JiraResult<JiraIssue>> {
    return this.request<JiraIssue>("GET", `/rest/api/3/issue/${issueKey}`, {
      query: expand.length ? { expand: expand.join(",") } : undefined,
    });
  }

  /** `/rest/api/3/project/{projectKey}`. */
  public async getProject(
    projectKey: string,
  ): Promise<JiraResult<JiraProject>> {
    return this.request<JiraProject>(
      "GET",
      `/rest/api/3/project/${projectKey}`,
    );
  }
}

// ── Response types (partial; only fields we surface) ──────────────────

export interface JiraIssue {
  key: string;
  fields?: {
    summary?: string;
    status?: { name?: string };
    assignee?: { displayName?: string } | null;
    labels?: string[];
    updated?: string;
  };
}

export interface JiraSearchResponse {
  total: number;
  issues: JiraIssue[];
  maxResults?: number;
  startAt?: number;
}

export interface JiraProject {
  key: string;
  name?: string;
  description?: string;
  lead?: { displayName?: string } | null;
  issueTypes?: Array<{ name?: string }>;
}

function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  return null;
}

function classifyHttpStatus(status: number): string {
  if (status === 401 || status === 403) return "UNAUTHORIZED";
  if (status === 404) return "NOT_FOUND";
  if (status === 400) return "BAD_REQUEST";
  return "HTTP_ERROR";
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}
