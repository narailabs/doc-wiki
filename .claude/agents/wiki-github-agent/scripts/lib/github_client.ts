/**
 * github_client.ts — read-only GitHub REST + GraphQL client.
 *
 * Uses a Personal Access Token via `Authorization: Bearer`. Only GET (REST)
 * and POST against `/graphql` (read-only queries) are permitted.
 */
import { validateUrl } from "../../../lib/security_check.js";
import { resolveSecret } from "../../../lib/credential_providers/index.js";

type HttpMethod = "GET" | "POST_GRAPHQL";
const ALLOWED_METHODS: ReadonlySet<HttpMethod> = new Set<HttpMethod>([
  "GET",
  "POST_GRAPHQL",
]);

const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
const DEFAULT_READ_TIMEOUT_MS = 30_000;
const DEFAULT_RATE_LIMIT_PER_MIN = 60;
const MAX_ATTEMPTS = 4;

const GITHUB_API_BASE = "https://api.github.com";

export interface GithubClientOptions {
  token: string;
  apiBase?: string;
  rateLimitPerMin?: number;
  connectTimeoutMs?: number;
  readTimeoutMs?: number;
  fetchImpl?: typeof globalThis.fetch;
  sleepImpl?: (ms: number) => Promise<void>;
}

export interface GithubErrorPayload {
  ok: false;
  code: string;
  message: string;
  retriable: boolean;
  status?: number;
}
export interface GithubSuccessPayload<T> {
  ok: true;
  data: T;
  status: number;
}
export type GithubResult<T> = GithubSuccessPayload<T> | GithubErrorPayload;

export async function loadGithubCredentials(): Promise<
  { token: string } | null
> {
  const token =
    (await resolveSecret("GITHUB_TOKEN")) ??
    process.env["GITHUB_TOKEN"] ??
    null;
  if (!token) return null;
  return { token };
}

export class GithubClient {
  private readonly _apiBase: string;
  private readonly _token: string;
  private readonly _rateLimitPerMin: number;
  private readonly _connectTimeoutMs: number;
  private readonly _readTimeoutMs: number;
  private readonly _fetch: typeof globalThis.fetch;
  private readonly _sleep: (ms: number) => Promise<void>;
  private _requestTimestamps: number[] = [];

  constructor(opts: GithubClientOptions) {
    const base = opts.apiBase ?? GITHUB_API_BASE;
    if (!validateUrl(base)) {
      throw new Error(`Invalid GitHub API base: ${base}`);
    }
    this._apiBase = base.replace(/\/+$/, "");
    this._token = opts.token;
    this._rateLimitPerMin = opts.rateLimitPerMin ?? DEFAULT_RATE_LIMIT_PER_MIN;
    this._connectTimeoutMs = opts.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
    this._readTimeoutMs = opts.readTimeoutMs ?? DEFAULT_READ_TIMEOUT_MS;
    this._fetch = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this._sleep =
      opts.sleepImpl ??
      ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
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

  private buildUrl(relPath: string, query?: Record<string, unknown>): string {
    const rel = relPath.startsWith("/") ? relPath : `/${relPath}`;
    const base = `${this._apiBase}${rel}`;
    if (!query) return base;
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null) continue;
      params.append(k, String(v));
    }
    const qs = params.toString();
    return qs ? `${base}?${qs}` : base;
  }

  public async get<T = unknown>(
    relPath: string,
    query?: Record<string, unknown>,
  ): Promise<GithubResult<T>> {
    return this._send<T>("GET", this.buildUrl(relPath, query), null);
  }

  public async graphql<T = unknown>(
    queryDoc: string,
    variables: Record<string, unknown> = {},
  ): Promise<GithubResult<T>> {
    const url = `${this._apiBase}/graphql`;
    return this._send<T>("POST_GRAPHQL", url, {
      query: queryDoc,
      variables,
    });
  }

  private async _send<T>(
    method: HttpMethod,
    url: string,
    body: Record<string, unknown> | null,
  ): Promise<GithubResult<T>> {
    if (!ALLOWED_METHODS.has(method)) {
      return {
        ok: false,
        code: "METHOD_NOT_ALLOWED",
        message: `Method ${method} not allowed`,
        retriable: false,
      };
    }
    if (!validateUrl(url)) {
      return {
        ok: false,
        code: "INVALID_URL",
        message: `URL rejected: ${url}`,
        retriable: false,
      };
    }

    let lastError: GithubErrorPayload | null = null;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      await this._throttle();
      const readCtrl = new AbortController();
      const readTimer = setTimeout(
        () => readCtrl.abort(),
        this._connectTimeoutMs + this._readTimeoutMs,
      );
      try {
        const init: RequestInit = {
          method: method === "POST_GRAPHQL" ? "POST" : "GET",
          headers: {
            Authorization: `Bearer ${this._token}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            ...(body ? { "Content-Type": "application/json" } : {}),
          },
          signal: readCtrl.signal,
        };
        if (body) init.body = JSON.stringify(body);

        const response = await this._fetch(url, init);
        const status = response.status;

        if (status === 429 || status === 403 && response.headers.get("x-ratelimit-remaining") === "0") {
          const retryAfter = parseRetryAfter(response.headers.get("retry-after"));
          lastError = {
            ok: false,
            code: "RATE_LIMITED",
            message: "GitHub rate limit hit",
            retriable: true,
            status,
          };
          if (attempt < MAX_ATTEMPTS - 1) {
            await this._sleep(retryAfter ?? Math.min(30_000, 500 * 2 ** attempt));
            continue;
          }
          return lastError;
        }

        if (status >= 500) {
          lastError = {
            ok: false,
            code: "SERVER_ERROR",
            message: `GitHub returned HTTP ${status}`,
            retriable: true,
            status,
          };
          if (attempt < MAX_ATTEMPTS - 1) {
            await this._sleep(Math.min(30_000, 500 * 2 ** attempt));
            continue;
          }
          return lastError;
        }

        if (!response.ok) {
          let bodyText = "";
          try {
            bodyText = await response.text();
          } catch { /* ignore */ }
          return {
            ok: false,
            code: classifyHttpStatus(status),
            message: `GitHub HTTP ${status}: ${truncate(bodyText, 200)}`,
            retriable: false,
            status,
          };
        }

        const data = (await response.json()) as T;
        return { ok: true, data, status };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const aborted = err instanceof DOMException || /abort/i.test(message);
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

  public async getRepo(
    owner: string,
    repo: string,
  ): Promise<GithubResult<GithubRepo>> {
    return this.get<GithubRepo>(`/repos/${owner}/${repo}`);
  }

  public async listIssues(
    owner: string,
    repo: string,
    opts: { state?: string; labels?: string[]; perPage?: number; page?: number } = {},
  ): Promise<GithubResult<GithubIssue[]>> {
    return this.get<GithubIssue[]>(`/repos/${owner}/${repo}/issues`, {
      state: opts.state ?? "open",
      labels: opts.labels?.join(",") ?? undefined,
      per_page: opts.perPage ?? 30,
      page: opts.page,
    });
  }

  public async listPulls(
    owner: string,
    repo: string,
    opts: { state?: string; perPage?: number; page?: number } = {},
  ): Promise<GithubResult<GithubPull[]>> {
    return this.get<GithubPull[]>(`/repos/${owner}/${repo}/pulls`, {
      state: opts.state ?? "open",
      per_page: opts.perPage ?? 30,
      page: opts.page,
    });
  }

  public async getFile(
    owner: string,
    repo: string,
    filePath: string,
    ref = "main",
  ): Promise<GithubResult<GithubContent>> {
    return this.get<GithubContent>(
      `/repos/${owner}/${repo}/contents/${filePath}`,
      { ref },
    );
  }

  public async searchCode(
    owner: string,
    repo: string,
    query: string,
    perPage = 30,
  ): Promise<GithubResult<GithubSearchCodeResponse>> {
    const q = `${query} repo:${owner}/${repo}`;
    return this.get<GithubSearchCodeResponse>("/search/code", {
      q,
      per_page: perPage,
    });
  }

  /** List wiki pages via GraphQL (repository has hasWikiEnabled flag). */
  public async listWikiPages(
    owner: string,
    repo: string,
  ): Promise<GithubResult<{ hasWikiEnabled: boolean }>> {
    const query = `
      query WikiPages($owner: String!, $repo: String!) {
        repository(owner: $owner, name: $repo) {
          hasWikiEnabled
        }
      }
    `;
    const res = await this.graphql<{ data?: { repository?: { hasWikiEnabled: boolean } } }>(
      query,
      { owner, repo },
    );
    if (!res.ok) return res;
    const enabled = res.data?.data?.repository?.hasWikiEnabled ?? false;
    return { ok: true, data: { hasWikiEnabled: enabled }, status: res.status };
  }
}

export interface GithubRepo {
  full_name: string;
  description?: string | null;
  default_branch?: string;
  language?: string | null;
  stargazers_count?: number;
  open_issues_count?: number;
  topics?: string[];
  updated_at?: string;
}

export interface GithubIssue {
  number: number;
  title: string;
  state: string;
  labels?: Array<{ name?: string } | string>;
  user?: { login?: string };
  html_url?: string;
  updated_at?: string;
}

export interface GithubPull {
  number: number;
  title: string;
  state: string;
  user?: { login?: string };
  html_url?: string;
  updated_at?: string;
}

export interface GithubContent {
  path: string;
  size: number;
  content?: string;
  encoding?: string;
  sha?: string;
}

export interface GithubSearchCodeResponse {
  total_count: number;
  items: Array<{
    path: string;
    repository: { full_name: string };
    html_url: string;
  }>;
}

function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  return null;
}

function classifyHttpStatus(status: number): string {
  if (status === 401) return "UNAUTHORIZED";
  if (status === 403) return "FORBIDDEN";
  if (status === 404) return "NOT_FOUND";
  if (status === 422) return "UNPROCESSABLE";
  if (status === 400) return "BAD_REQUEST";
  return "HTTP_ERROR";
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}
