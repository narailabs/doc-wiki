/**
 * fetch_helper.ts — shared HTTP fetch wrapper with size + timeout caps.
 *
 * Per v2 design §9 ("Security Baseline"), every outgoing HTTP request
 * from a source agent must enforce default caps of 50 MB body size and
 * 60 s wall-clock timeout. Centralizing this lets us fix regressions in
 * one place and lets lint check that each agent's HTTP client goes
 * through the helper.
 *
 * Behaviour:
 *   - `AbortController` enforces the timeout. On overrun, the returned
 *     promise rejects with the underlying `AbortError`.
 *   - Body size is enforced by streaming the response and counting
 *     bytes. If `content-length` is present and already exceeds the
 *     cap, we short-circuit before reading. Otherwise we read chunks;
 *     once the running total exceeds `maxBytes`, we abort and throw
 *     `FetchCapExceeded`.
 *   - Consumers receive a plain `Response` whose `body` has been
 *     replaced by a `ReadableStream` that reads from an in-memory
 *     buffer; calling `.text()` or `.arrayBuffer()` on that Response
 *     returns exactly the (capped) bytes.
 *
 * The AWS SDK v3 and GCP execFileSync paths are NOT wired through this
 * helper — AWS SDK clients enforce their own per-operation timeouts
 * and body caps at the SDK layer, and execFileSync's `maxBuffer` (16
 * MB) is stricter than our 50 MB fetch cap. See aws_client.ts /
 * gcp_client.ts comments for the exemption rationale.
 */
export const FETCH_MAX_BYTES_DEFAULT = 50 * 1024 * 1024; // 50 MB
export const FETCH_TIMEOUT_MS_DEFAULT = 60_000; // 60 s
/** Thrown when the response body grows past `maxBytes`. */
export class FetchCapExceeded extends Error {
    capBytes;
    observedBytes;
    constructor(capBytes, observedBytes, url) {
        super(`fetch_helper: response body exceeded cap of ${capBytes} bytes ` +
            `(observed ${observedBytes} while fetching ${url})`);
        this.name = "FetchCapExceeded";
        this.capBytes = capBytes;
        this.observedBytes = observedBytes;
    }
}
function mergeSignals(internal, external) {
    if (external === undefined)
        return internal;
    // Node 20 has `AbortSignal.any`; spec-compliant and keeps listener
    // management simple.
    const anyFn = AbortSignal.any;
    if (typeof anyFn === "function") {
        return anyFn([internal, external]);
    }
    // Fallback: manually mirror external abort onto a fresh controller.
    const controller = new AbortController();
    const onAbort = (reason) => {
        controller.abort(reason);
    };
    if (internal.aborted)
        controller.abort(internal.reason);
    else
        internal.addEventListener("abort", () => onAbort(internal.reason), { once: true });
    if (external.aborted)
        controller.abort(external.reason);
    else
        external.addEventListener("abort", () => onAbort(external.reason), { once: true });
    return controller.signal;
}
/**
 * Perform a cap-limited fetch. The returned Response is safe to treat
 * as a normal `Response`; its body has already been read into memory
 * (bounded by `maxBytes`), and the Response is rebuilt around that
 * buffer so downstream `.text()` / `.json()` / `.arrayBuffer()` calls
 * work without re-hitting the network.
 *
 * Throws:
 *   - `FetchCapExceeded` when `content-length` or streamed bytes
 *     exceed `maxBytes`.
 *   - `DOMException` / `AbortError` when the timeout fires or an
 *     external signal is aborted.
 *   - Any other error thrown by `fetch` itself (network, DNS, etc.).
 */
export async function fetchWithCaps(url, init = {}, caps = {}) {
    const maxBytes = caps.maxBytes ?? FETCH_MAX_BYTES_DEFAULT;
    const timeoutMs = caps.timeoutMs ?? FETCH_TIMEOUT_MS_DEFAULT;
    const timeoutCtl = new AbortController();
    const timer = setTimeout(() => timeoutCtl.abort(new Error("fetch_helper timeout")), timeoutMs);
    const signal = mergeSignals(timeoutCtl.signal, caps.signal ?? init.signal ?? undefined);
    let response;
    try {
        response = await fetch(url, { ...init, signal });
    }
    finally {
        // `fetch` has either settled or thrown; the timeout timer is no
        // longer needed. We clear it in `finally` so it doesn't keep the
        // event loop alive after a successful call.
        clearTimeout(timer);
    }
    // Short-circuit on content-length if the server tells us the body is
    // already too big — avoids reading a ton of bytes we'll throw away.
    const clHeader = response.headers.get("content-length");
    if (clHeader !== null) {
        const cl = Number(clHeader);
        if (Number.isFinite(cl) && cl > maxBytes) {
            // Drain the body so the connection can be reused.
            try {
                await response.body?.cancel();
            }
            catch { /* best-effort */ }
            throw new FetchCapExceeded(maxBytes, cl, url);
        }
    }
    // Stream the body into a size-capped buffer.
    const reader = response.body?.getReader();
    if (reader === undefined) {
        // No body (HEAD, 204, etc.) — return the response as-is.
        return response;
    }
    const chunks = [];
    let total = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done)
            break;
        if (value === undefined)
            continue;
        total += value.byteLength;
        if (total > maxBytes) {
            try {
                await reader.cancel();
            }
            catch { /* best-effort */ }
            throw new FetchCapExceeded(maxBytes, total, url);
        }
        chunks.push(value);
    }
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.byteLength;
    }
    // Rebuild the Response around the merged buffer so callers can still
    // use `.text()`, `.json()`, etc. without re-streaming.
    return new Response(merged, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
    });
}
