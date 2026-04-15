/**
 * github_client.ts — read-only GitHub REST + GraphQL client.
 *
 * Uses a Personal Access Token via `Authorization: Bearer`. Only GET (REST)
 * and POST against `/graphql` (read-only queries) are permitted.
 */
import { validateUrl } from "../../../lib/security_check.js";
import { resolveSecret } from "../../../lib/credential_providers/index.js";
const ALLOWED_METHODS = new Set([
    "GET",
    "POST_GRAPHQL",
]);
const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
const DEFAULT_READ_TIMEOUT_MS = 30_000;
const DEFAULT_RATE_LIMIT_PER_MIN = 60;
const MAX_ATTEMPTS = 4;
const GITHUB_API_BASE = "https://api.github.com";
export async function loadGithubCredentials() {
    const token = (await resolveSecret("GITHUB_TOKEN")) ??
        process.env["GITHUB_TOKEN"] ??
        null;
    if (!token)
        return null;
    return { token };
}
export class GithubClient {
    _apiBase;
    _token;
    _rateLimitPerMin;
    _connectTimeoutMs;
    _readTimeoutMs;
    _fetch;
    _sleep;
    _requestTimestamps = [];
    constructor(opts) {
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
                ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    }
    async _throttle() {
        const now = Date.now();
        const cutoff = now - 60_000;
        this._requestTimestamps = this._requestTimestamps.filter((t) => t > cutoff);
        if (this._requestTimestamps.length >= this._rateLimitPerMin) {
            const oldest = this._requestTimestamps[0] ?? now;
            const waitMs = Math.max(0, 60_000 - (now - oldest));
            if (waitMs > 0)
                await this._sleep(waitMs);
            this._requestTimestamps = this._requestTimestamps.filter((t) => t > Date.now() - 60_000);
        }
        this._requestTimestamps.push(Date.now());
    }
    buildUrl(relPath, query) {
        const rel = relPath.startsWith("/") ? relPath : `/${relPath}`;
        const base = `${this._apiBase}${rel}`;
        if (!query)
            return base;
        const params = new URLSearchParams();
        for (const [k, v] of Object.entries(query)) {
            if (v === undefined || v === null)
                continue;
            params.append(k, String(v));
        }
        const qs = params.toString();
        return qs ? `${base}?${qs}` : base;
    }
    async get(relPath, query) {
        return this._send("GET", this.buildUrl(relPath, query), null);
    }
    async graphql(queryDoc, variables = {}) {
        const url = `${this._apiBase}/graphql`;
        return this._send("POST_GRAPHQL", url, {
            query: queryDoc,
            variables,
        });
    }
    async _send(method, url, body) {
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
        let lastError = null;
        for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
            await this._throttle();
            const readCtrl = new AbortController();
            const readTimer = setTimeout(() => readCtrl.abort(), this._connectTimeoutMs + this._readTimeoutMs);
            try {
                const init = {
                    method: method === "POST_GRAPHQL" ? "POST" : "GET",
                    headers: {
                        Authorization: `Bearer ${this._token}`,
                        Accept: "application/vnd.github+json",
                        "X-GitHub-Api-Version": "2022-11-28",
                        ...(body ? { "Content-Type": "application/json" } : {}),
                    },
                    signal: readCtrl.signal,
                };
                if (body)
                    init.body = JSON.stringify(body);
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
                    }
                    catch { /* ignore */ }
                    return {
                        ok: false,
                        code: classifyHttpStatus(status),
                        message: `GitHub HTTP ${status}: ${truncate(bodyText, 200)}`,
                        retriable: false,
                        status,
                    };
                }
                const data = (await response.json());
                return { ok: true, data, status };
            }
            catch (err) {
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
            }
            finally {
                clearTimeout(readTimer);
            }
        }
        return (lastError ?? {
            ok: false,
            code: "UNKNOWN",
            message: "Exhausted retries without a response",
            retriable: true,
        });
    }
    async getRepo(owner, repo) {
        return this.get(`/repos/${owner}/${repo}`);
    }
    async listIssues(owner, repo, opts = {}) {
        return this.get(`/repos/${owner}/${repo}/issues`, {
            state: opts.state ?? "open",
            labels: opts.labels?.join(",") ?? undefined,
            per_page: opts.perPage ?? 30,
        });
    }
    async listPulls(owner, repo, opts = {}) {
        return this.get(`/repos/${owner}/${repo}/pulls`, {
            state: opts.state ?? "open",
            per_page: opts.perPage ?? 30,
        });
    }
    async getFile(owner, repo, filePath, ref = "main") {
        return this.get(`/repos/${owner}/${repo}/contents/${filePath}`, { ref });
    }
    async searchCode(owner, repo, query, perPage = 30) {
        const q = `${query} repo:${owner}/${repo}`;
        return this.get("/search/code", {
            q,
            per_page: perPage,
        });
    }
    /** List wiki pages via GraphQL (repository has hasWikiEnabled flag). */
    async listWikiPages(owner, repo) {
        const query = `
      query WikiPages($owner: String!, $repo: String!) {
        repository(owner: $owner, name: $repo) {
          hasWikiEnabled
        }
      }
    `;
        const res = await this.graphql(query, { owner, repo });
        if (!res.ok)
            return res;
        const enabled = res.data?.data?.repository?.hasWikiEnabled ?? false;
        return { ok: true, data: { hasWikiEnabled: enabled }, status: res.status };
    }
}
function parseRetryAfter(value) {
    if (!value)
        return null;
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0)
        return seconds * 1000;
    return null;
}
function classifyHttpStatus(status) {
    if (status === 401)
        return "UNAUTHORIZED";
    if (status === 403)
        return "FORBIDDEN";
    if (status === 404)
        return "NOT_FOUND";
    if (status === 422)
        return "UNPROCESSABLE";
    if (status === 400)
        return "BAD_REQUEST";
    return "HTTP_ERROR";
}
function truncate(s, n) {
    return s.length > n ? s.slice(0, n) + "…" : s;
}
