/**
 * apply_config — small runtime helpers that translate blocks from
 * `wiki.config.yaml` into live state (credential registry, etc.).
 *
 * Phase H scope: only the `credentials` block is wired today. Phase C/D/E
 * code reads secrets via `resolveSecret()` from `credential_providers`,
 * which needs at least one provider registered up front.
 */
import {
  registerProvider,
  EnvVarProvider,
  FileProvider,
  KeychainProvider,
  CloudSecretsProvider,
  type CloudSubProvider,
} from "narai-primitives/credentials";

/** Shape of the top-level `credentials` block emitted by init_wiki. */
export interface CredentialsConfig {
  provider?: string;
  fallback?: string[];
  prefix?: string;
  sub_provider?: CloudSubProvider;
  // Passthrough for file / cloud-specific knobs.
  path?: string;
  aws_region?: string;
  gcp_project_id?: string;
  gcp_version?: string;
  azure_vault_url?: string;
}

/**
 * Merge the two credential blocks that can appear in `wiki.config.yaml`:
 *
 *   - `ecosystem.credentials` — the design §15 ornamental block
 *   - top-level `credentials`  — what apply_config actually reads
 *
 * Precedence: top-level wins key-by-key; ecosystem fills in anything the
 * top-level omits. This lets a user edit *either* block and still get the
 * expected behavior. Returns `{}` when both blocks are absent.
 *
 * Accepts any object shape (typically the parsed yaml) so the caller does
 * not need to re-derive the two paths.
 */
export function mergeCredentialsConfig(
  parsed: Record<string, unknown> | null | undefined,
): CredentialsConfig {
  const root = _asObject(parsed);
  const top = _asObject(root["credentials"]);
  const eco = _asObject(_asObject(root["ecosystem"])["credentials"]);
  return { ...eco, ...top } as CredentialsConfig;
}

function _asObject(v: unknown): Record<string, unknown> {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }
  return {};
}

/**
 * Register one provider per name referenced by the config (primary plus
 * any fallback entries). Idempotent — callers registering the same name
 * twice simply overwrite the prior instance. Returns the list of names
 * that were actually registered so the caller can log or assert.
 */
export function applyCredentialsConfig(cfg: CredentialsConfig): string[] {
  const names = new Set<string>();
  if (cfg.provider) names.add(cfg.provider);
  for (const f of cfg.fallback ?? []) names.add(f);

  const registered: string[] = [];
  for (const name of names) {
    switch (name) {
      case "env_var":
        registerProvider("env_var", new EnvVarProvider({ prefix: cfg.prefix }));
        registered.push("env_var");
        break;
      case "keychain":
        registerProvider("keychain", new KeychainProvider());
        registered.push("keychain");
        break;
      case "file":
        registerProvider(
          "file",
          new FileProvider({ path: cfg.path ?? "~/.wiki/credentials.json" }),
        );
        registered.push("file");
        break;
      case "cloud_secrets":
        if (!cfg.sub_provider) break; // skip if not configured
        registerProvider(
          "cloud_secrets",
          new CloudSecretsProvider({
            subProvider: cfg.sub_provider,
            awsRegion: cfg.aws_region,
            gcpProjectId: cfg.gcp_project_id,
            gcpVersion: cfg.gcp_version,
            azureVaultUrl: cfg.azure_vault_url,
          }),
        );
        registered.push("cloud_secrets");
        break;
      // Unknown names silently ignored — lets init proceed without
      // failing on forward-compat keys.
    }
  }
  return registered;
}
