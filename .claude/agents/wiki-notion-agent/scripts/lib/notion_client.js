/**
 * notion_client.ts — read-only Notion Public API client.
 *
 * Notion's API uses POST for `/v1/search` and `/v1/databases/{id}/query`
 * (body-bound filters) even though they are logically read-only; the
 * method whitelist therefore permits these two named endpoints via a
 * `POST_READ_ONLY` pseudo-method in addition to the standard GETs.
 */
import { validateUrl } from "../../../lib/security_check.js";
import { resolveSecret } from "../../../lib/credential_providers/index.js";
const ALLOWED_METHODS = new Set([
    "GET",
    "POST_READ_ONLY",
]);
const ALLOWED_POST_PATHS = new Set([
    "/v1/search",
    // Database query paths match `/v1/databases/{id}/query` — checked via prefix/suffix.
]);
const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
const DEFAULT_READ_TIMEOUT_MS = 30_000;
const DEFAULT_RATE_LIMIT_PER_MIN = 60;
const MAX_ATTEMPTS = 4;
const NOTION_API_BASE = "https://api.notion.com";
const NOTION_VERSION = "2022-06-28";
export async function loadNotionCredentials() {
    const token = (await resolveSecret("NOTION_TOKEN")) ??
        process.env["NOTION_TOKEN"] ??
        null;
    if (!token)
        return null;
    return { token };
}
function isAllowedPostPath(path) {
    if (ALLOWED_POST_PATHS.has(path))
        return true;
    // Database query: /v1/databases/{id}/query
    return /^\/v1\/databases\/[0-9a-fA-F-]{32,}\/query$/.test(path);
}
export class NotionClient {
    _apiBase;
    _token;
    _rateLimitPerMin;
    _connectTimeoutMs;
    _readTimeoutMs;
    _fetch;
    _sleep;
    _requestTimestamps = [];
    constructor(opts) {
        const base = opts.apiBase ?? NOTION_API_BASE;
        if (!validateUrl(base)) {
            throw new Error(`Invalid Notion API base: ${base}`);
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
    async request(method, relPath, body = null) {
        if (!ALLOWED_METHODS.has(method)) {
            return {
                ok: false,
                code: "METHOD_NOT_ALLOWED",
                message: `Method ${method} not allowed`,
                retriable: false,
            };
        }
        if (method === "POST_READ_ONLY" && !isAllowedPostPath(relPath)) {
            return {
                ok: false,
                code: "METHOD_NOT_ALLOWED",
                message: `POST is only permitted on read-only endpoints; got ${relPath}`,
                retriable: false,
            };
        }
        const url = `${this._apiBase}${relPath}`;
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
                    method: method === "POST_READ_ONLY" ? "POST" : "GET",
                    headers: {
                        Authorization: `Bearer ${this._token}`,
                        "Notion-Version": NOTION_VERSION,
                        Accept: "application/json",
                        ...(body ? { "Content-Type": "application/json" } : {}),
                    },
                    signal: readCtrl.signal,
                };
                if (body)
                    init.body = JSON.stringify(body);
                const response = await this._fetch(url, init);
                const status = response.status;
                if (status === 429 || status >= 500) {
                    const retryAfter = parseRetryAfter(response.headers.get("retry-after"));
                    lastError = {
                        ok: false,
                        code: status === 429 ? "RATE_LIMITED" : "SERVER_ERROR",
                        message: `Notion returned HTTP ${status}`,
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
                    let bodyText = "";
                    try {
                        bodyText = await response.text();
                    }
                    catch { /* ignore */ }
                    return {
                        ok: false,
                        code: classifyHttpStatus(status),
                        message: `Notion HTTP ${status}: ${truncate(bodyText, 200)}`,
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
    async search(query, filterType, pageSize) {
        const body = { query, page_size: pageSize };
        if (filterType)
            body["filter"] = { property: "object", value: filterType };
        return this.request("POST_READ_ONLY", "/v1/search", body);
    }
    async getPage(pageId) {
        return this.request("GET", `/v1/pages/${pageId}`);
    }
    async getDatabase(databaseId) {
        return this.request("GET", `/v1/databases/${databaseId}`);
    }
    async queryDatabase(databaseId, filter, pageSize) {
        const body = { page_size: pageSize };
        if (filter)
            body["filter"] = filter;
        return this.request("POST_READ_ONLY", `/v1/databases/${databaseId}/query`, body);
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
    if (status === 400)
        return "BAD_REQUEST";
    if (status === 422)
        return "UNPROCESSABLE";
    return "HTTP_ERROR";
}
function truncate(s, n) {
    return s.length > n ? s.slice(0, n) + "…" : s;
}
export function extractTitleFromPage(page) {
    const props = page.properties ?? {};
    for (const value of Object.values(props)) {
        if (value &&
            typeof value === "object" &&
            !Array.isArray(value) &&
            value["type"] === "title") {
            const titleProp = value;
            const title = titleProp["title"];
            if (Array.isArray(title)) {
                return title
                    .map((t) => {
                    if (t && typeof t === "object") {
                        const pt = t["plain_text"];
                        return typeof pt === "string" ? pt : "";
                    }
                    return "";
                })
                    .join("");
            }
        }
    }
    return "";
}
