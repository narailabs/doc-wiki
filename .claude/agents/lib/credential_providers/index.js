/**
 * credential_providers — pluggable secret-backend layer.
 *
 * Each provider implements {@link CredentialProvider}. The registry keyed by
 * provider-name lets the config layer (Phase H `wiki.config.yaml` →
 * `credentials.provider`) pick a provider by string.
 *
 * The `resolveSecret(name, options)` helper chains providers in the given
 * fallback order, returning the first non-null hit.
 */
const _registry = new Map();
/** Register a provider under a short name (`keychain`, `env_var`, …). */
export function registerProvider(name, provider) {
    _registry.set(name, provider);
}
/** Look up a provider previously registered via {@link registerProvider}. */
export function getProvider(name) {
    return _registry.get(name);
}
/** Test helper — drop all registered providers. */
export function clearProviders() {
    _registry.clear();
}
/** Return the list of currently registered provider names. */
export function listProviders() {
    return [..._registry.keys()];
}
/**
 * Resolve a secret through a primary provider and optional fallback chain.
 *
 * Returns `null` if no provider produces a value. If every provider throws,
 * the last error is surfaced so the caller can inspect it.
 */
export async function resolveSecret(name, options = {}) {
    const order = [];
    if (options.provider)
        order.push(options.provider);
    if (options.fallback)
        order.push(...options.fallback);
    if (order.length === 0) {
        // Default: iterate whatever is in the registry, insertion order.
        order.push(..._registry.keys());
    }
    let lastError = null;
    let anySuccess = false;
    for (const providerName of order) {
        const provider = _registry.get(providerName);
        if (!provider)
            continue;
        try {
            const value = await provider.getSecret(name);
            anySuccess = true;
            if (value !== null)
                return value;
        }
        catch (err) {
            lastError = err;
        }
    }
    if (!anySuccess && lastError !== null) {
        throw lastError;
    }
    return null;
}
// Re-export provider implementations so callers can import everything from
// `credential_providers` directly.
export { FileProvider } from "./file.js";
export { EnvVarProvider } from "./env_var.js";
export { KeychainProvider } from "./keychain.js";
export { CloudSecretsProvider } from "./cloud_secrets.js";
