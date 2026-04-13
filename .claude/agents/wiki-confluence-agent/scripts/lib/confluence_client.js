/**
 * confluence_client.ts — read-only Atlassian Confluence REST v1 HTTP client.
 * Shares the Basic-auth + rate-limit + retry design with jira_client.ts.
 */
import { validateUrl } from "../../../../skills/wiki/scripts/security_check.js";
import { resolveSecret } from "../../../lib/credential_providers/index.js";
const ALLOWED_METHODS = new Set(["GET"]);
const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
const DEFAULT_READ_TIMEOUT_MS = 30_000;
const DEFAULT_RATE_LIMIT_PER_MIN = 60;
const MAX_ATTEMPTS = 4;
export async function loadConfluenceCredentials() {
    const siteUrl = process.env["CONFLUENCE_SITE_URL"] ?? null;
    const email = (await resolveSecret("CONFLUENCE_EMAIL")) ??
        process.env["CONFLUENCE_EMAIL"] ??
        null;
    const apiToken = (await resolveSecret("CONFLUENCE_API_TOKEN")) ??
        process.env["CONFLUENCE_API_TOKEN"] ??
        null;
    if (!siteUrl || !email || !apiToken)
        return null;
    return { siteUrl, email, apiToken };
}
export class ConfluenceClient {
    _site;
    _authHeader;
    _rateLimitPerMin;
    _connectTimeoutMs;
    _readTimeoutMs;
    _fetch;
    _sleep;
    _requestTimestamps = [];
    constructor(opts) {
        if (!validateUrl(opts.siteUrl)) {
            throw new Error(`Invalid Confluence site URL: ${opts.siteUrl}`);
        }
        this._site = opts.siteUrl.replace(/\/+$/, "");
        const basic = Buffer.from(`${opts.email}:${opts.apiToken}`, "utf-8").toString("base64");
        this._authHeader = `Basic ${basic}`;
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
    buildUrl(path, query) {
        const relative = path.startsWith("/") ? path : `/${path}`;
        const base = `${this._site}${relative}`;
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
    async request(method, path, init = {}) {
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
        let lastError = null;
        for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
            await this._throttle();
            const readCtrl = new AbortController();
            const readTimer = setTimeout(() => readCtrl.abort(), this._connectTimeoutMs + this._readTimeoutMs);
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
                const status = response.status;
                if (status === 429 || status >= 500) {
                    const retryAfter = parseRetryAfter(response.headers.get("retry-after"));
                    lastError = {
                        ok: false,
                        code: status === 429 ? "RATE_LIMITED" : "SERVER_ERROR",
                        message: `Confluence returned HTTP ${status}`,
                        retriable: true,
                        status,
                    };
                    if (attempt < MAX_ATTEMPTS - 1) {
                        await this._sleep(retryAfter ?? Math.min(30_000, 500 * 2 ** attempt));
                        continue;
                    }
                    return lastError;
                }
                if (!response.ok) {
                    let body = "";
                    try {
                        body = await response.text();
                    }
                    catch { /* ignore */ }
                    return {
                        ok: false,
                        code: classifyHttpStatus(status),
                        message: `Confluence HTTP ${status}: ${truncate(body, 200)}`,
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
    async searchCql(cql, limit, start = 0) {
        return this.request("GET", "/wiki/rest/api/content/search", { query: { cql, limit, start, expand: "space,version" } });
    }
    async getContent(id, expand = ["body.storage", "space", "version"]) {
        return this.request("GET", `/wiki/rest/api/content/${id}`, { query: { expand: expand.join(",") } });
    }
    async getSpace(spaceKey) {
        return this.request("GET", `/wiki/rest/api/space/${spaceKey}`, { query: { expand: "description,homepage" } });
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
    if (status === 401 || status === 403)
        return "UNAUTHORIZED";
    if (status === 404)
        return "NOT_FOUND";
    if (status === 400)
        return "BAD_REQUEST";
    return "HTTP_ERROR";
}
function truncate(s, n) {
    return s.length > n ? s.slice(0, n) + "…" : s;
}
