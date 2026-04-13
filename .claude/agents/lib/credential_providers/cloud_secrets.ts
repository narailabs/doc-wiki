/**
 * cloud_secrets.ts — Dispatcher over cloud secret managers.
 *
 * Sub-providers:
 *   - `aws`   → AWS Secrets Manager via `@aws-sdk/client-secrets-manager`
 *   - `gcp`   → GCP Secret Manager    via `@google-cloud/secret-manager`
 *   - `azure` → Azure Key Vault       via `@azure/keyvault-secrets`
 *
 * SDKs are loaded with dynamic `import()` so the package installs stay
 * optional. If a requested sub-provider's SDK is missing, we throw an
 * error instructing the user to `npm install` the matching package.
 *
 * All calls are read-only (`getSecret`). Write/rotate flows are
 * intentionally out of scope for wiki_db (design §4 — read-only access).
 */
import type { CredentialProvider } from "./index.js";

export type CloudSubProvider = "aws" | "gcp" | "azure";

export interface CloudSecretsConfig {
  /** Which cloud secret manager to call. */
  subProvider: CloudSubProvider;
  /** AWS region (required for AWS). */
  awsRegion?: string;
  /** GCP project ID (required for GCP). */
  gcpProjectId?: string;
  /** GCP secret version (defaults to `latest`). */
  gcpVersion?: string;
  /** Azure Key Vault URL, e.g. `https://my-vault.vault.azure.net`. */
  azureVaultUrl?: string;
  /**
   * Escape hatch — inject a pre-built SDK client (used by tests to bypass
   * the dynamic `import()` step). Shape depends on `subProvider`.
   */
  _client?: unknown;
}

export class CloudSecretsProvider implements CredentialProvider {
  private readonly _config: CloudSecretsConfig;
  private _clientPromise: Promise<unknown> | null = null;

  constructor(config: CloudSecretsConfig) {
    this._config = config;
  }

  async getSecret(name: string): Promise<string | null> {
    const client = await this._client();
    const isInjected = this._config._client !== undefined;
    switch (this._config.subProvider) {
      case "aws":
        return _awsGetSecret(client, name, { skipSdkLoad: isInjected });
      case "gcp":
        return _gcpGetSecret(client, name, this._config);
      case "azure":
        return _azureGetSecret(client, name);
      default: {
        const p: never = this._config.subProvider;
        throw new Error(`unsupported sub_provider '${String(p)}'`);
      }
    }
  }

  private _client(): Promise<unknown> {
    if (this._config._client !== undefined) {
      return Promise.resolve(this._config._client);
    }
    if (this._clientPromise !== null) return this._clientPromise;
    this._clientPromise = this._buildClient();
    return this._clientPromise;
  }

  private async _buildClient(): Promise<unknown> {
    switch (this._config.subProvider) {
      case "aws": {
        const region = this._config.awsRegion;
        if (!region) {
          throw new Error("cloud_secrets aws: awsRegion is required");
        }
        const mod = await _loadOptional(
          "@aws-sdk/client-secrets-manager",
          "npm install --save @aws-sdk/client-secrets-manager",
        );
        const SecretsManagerClient = (mod as {
          SecretsManagerClient: new (opts: { region: string }) => unknown;
        }).SecretsManagerClient;
        return new SecretsManagerClient({ region });
      }
      case "gcp": {
        if (!this._config.gcpProjectId) {
          throw new Error("cloud_secrets gcp: gcpProjectId is required");
        }
        const mod = await _loadOptional(
          "@google-cloud/secret-manager",
          "npm install --save @google-cloud/secret-manager",
        );
        const SecretManagerServiceClient = (mod as {
          SecretManagerServiceClient: new () => unknown;
        }).SecretManagerServiceClient;
        return new SecretManagerServiceClient();
      }
      case "azure": {
        const url = this._config.azureVaultUrl;
        if (!url) {
          throw new Error("cloud_secrets azure: azureVaultUrl is required");
        }
        const [secretsMod, identityMod] = await Promise.all([
          _loadOptional(
            "@azure/keyvault-secrets",
            "npm install --save @azure/keyvault-secrets",
          ),
          _loadOptional(
            "@azure/identity",
            "npm install --save @azure/identity",
          ),
        ]);
        const SecretClient = (secretsMod as {
          SecretClient: new (vaultUrl: string, credential: unknown) => unknown;
        }).SecretClient;
        const DefaultAzureCredential = (identityMod as {
          DefaultAzureCredential: new () => unknown;
        }).DefaultAzureCredential;
        return new SecretClient(url, new DefaultAzureCredential());
      }
      default: {
        const p: never = this._config.subProvider;
        throw new Error(`unsupported sub_provider '${String(p)}'`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Sub-provider call implementations
// ---------------------------------------------------------------------------

async function _awsGetSecret(
  client: unknown,
  name: string,
  opts: { skipSdkLoad?: boolean } = {},
): Promise<string | null> {
  // When the caller injects its own client (tests), we don't need the real
  // command class — `send(obj)` works with any shape. For production runs
  // we load the SDK-provided command so the client can route correctly.
  let command: unknown = { SecretId: name };
  if (!opts.skipSdkLoad) {
    const mod = await _loadOptional(
      "@aws-sdk/client-secrets-manager",
      "npm install --save @aws-sdk/client-secrets-manager",
    );
    const GetSecretValueCommand = (mod as {
      GetSecretValueCommand: new (input: { SecretId: string }) => unknown;
    }).GetSecretValueCommand;
    command = new GetSecretValueCommand({ SecretId: name });
  }

  const send = (client as { send: (cmd: unknown) => Promise<unknown> }).send;
  try {
    const resp = (await send.call(client, command)) as {
      SecretString?: string;
      SecretBinary?: Uint8Array;
    };
    if (resp.SecretString !== undefined) return resp.SecretString;
    if (resp.SecretBinary !== undefined) {
      return Buffer.from(resp.SecretBinary).toString("utf-8");
    }
    return null;
  } catch (err) {
    if (_isAwsNotFound(err)) return null;
    throw err;
  }
}

async function _gcpGetSecret(
  client: unknown,
  name: string,
  config: CloudSecretsConfig,
): Promise<string | null> {
  const version = config.gcpVersion ?? "latest";
  const fullName = `projects/${config.gcpProjectId}/secrets/${name}/versions/${version}`;
  const c = client as {
    accessSecretVersion: (opts: { name: string }) => Promise<unknown[]>;
  };
  try {
    const [response] = await c.accessSecretVersion({ name: fullName });
    const payload = (response as { payload?: { data?: Uint8Array | string } })
      .payload;
    if (!payload?.data) return null;
    if (typeof payload.data === "string") return payload.data;
    return Buffer.from(payload.data).toString("utf-8");
  } catch (err) {
    if (_isGcpNotFound(err)) return null;
    throw err;
  }
}

async function _azureGetSecret(
  client: unknown,
  name: string,
): Promise<string | null> {
  const c = client as {
    getSecret: (n: string) => Promise<{ value?: string }>;
  };
  try {
    const resp = await c.getSecret(name);
    return resp.value ?? null;
  } catch (err) {
    if (_isAzureNotFound(err)) return null;
    throw err;
  }
}

// ---------------------------------------------------------------------------

async function _loadOptional(
  pkg: string,
  install: string,
): Promise<unknown> {
  try {
    return (await import(pkg)) as unknown;
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ERR_MODULE_NOT_FOUND" || e.code === "MODULE_NOT_FOUND") {
      throw new Error(
        `cloud_secrets: package '${pkg}' is not installed. Run: ${install}`,
      );
    }
    throw err;
  }
}

function _isAwsNotFound(err: unknown): boolean {
  const e = err as { name?: string; Code?: string };
  return e.name === "ResourceNotFoundException" || e.Code === "ResourceNotFoundException";
}

function _isGcpNotFound(err: unknown): boolean {
  const e = err as { code?: number | string };
  // grpc status 5 = NOT_FOUND.
  return e.code === 5 || e.code === "5";
}

function _isAzureNotFound(err: unknown): boolean {
  const e = err as { code?: string; statusCode?: number };
  return e.code === "SecretNotFound" || e.statusCode === 404;
}
