export class CloudSecretsProvider {
    _config;
    _clientPromise = null;
    constructor(config) {
        this._config = config;
    }
    async getSecret(name) {
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
                const p = this._config.subProvider;
                throw new Error(`unsupported sub_provider '${String(p)}'`);
            }
        }
    }
    _client() {
        if (this._config._client !== undefined) {
            return Promise.resolve(this._config._client);
        }
        if (this._clientPromise !== null)
            return this._clientPromise;
        this._clientPromise = this._buildClient();
        return this._clientPromise;
    }
    async _buildClient() {
        switch (this._config.subProvider) {
            case "aws": {
                const region = this._config.awsRegion;
                if (!region) {
                    throw new Error("cloud_secrets aws: awsRegion is required");
                }
                const mod = await _loadOptional("@aws-sdk/client-secrets-manager", "npm install --save @aws-sdk/client-secrets-manager");
                const SecretsManagerClient = mod.SecretsManagerClient;
                return new SecretsManagerClient({ region });
            }
            case "gcp": {
                if (!this._config.gcpProjectId) {
                    throw new Error("cloud_secrets gcp: gcpProjectId is required");
                }
                const mod = await _loadOptional("@google-cloud/secret-manager", "npm install --save @google-cloud/secret-manager");
                const SecretManagerServiceClient = mod.SecretManagerServiceClient;
                return new SecretManagerServiceClient();
            }
            case "azure": {
                const url = this._config.azureVaultUrl;
                if (!url) {
                    throw new Error("cloud_secrets azure: azureVaultUrl is required");
                }
                const [secretsMod, identityMod] = await Promise.all([
                    _loadOptional("@azure/keyvault-secrets", "npm install --save @azure/keyvault-secrets"),
                    _loadOptional("@azure/identity", "npm install --save @azure/identity"),
                ]);
                const SecretClient = secretsMod.SecretClient;
                const DefaultAzureCredential = identityMod.DefaultAzureCredential;
                return new SecretClient(url, new DefaultAzureCredential());
            }
            default: {
                const p = this._config.subProvider;
                throw new Error(`unsupported sub_provider '${String(p)}'`);
            }
        }
    }
}
// ---------------------------------------------------------------------------
// Sub-provider call implementations
// ---------------------------------------------------------------------------
async function _awsGetSecret(client, name, opts = {}) {
    // When the caller injects its own client (tests), we don't need the real
    // command class — `send(obj)` works with any shape. For production runs
    // we load the SDK-provided command so the client can route correctly.
    let command = { SecretId: name };
    if (!opts.skipSdkLoad) {
        const mod = await _loadOptional("@aws-sdk/client-secrets-manager", "npm install --save @aws-sdk/client-secrets-manager");
        const GetSecretValueCommand = mod.GetSecretValueCommand;
        command = new GetSecretValueCommand({ SecretId: name });
    }
    const send = client.send;
    try {
        const resp = (await send.call(client, command));
        if (resp.SecretString !== undefined)
            return resp.SecretString;
        if (resp.SecretBinary !== undefined) {
            return Buffer.from(resp.SecretBinary).toString("utf-8");
        }
        return null;
    }
    catch (err) {
        if (_isAwsNotFound(err))
            return null;
        throw err;
    }
}
async function _gcpGetSecret(client, name, config) {
    const version = config.gcpVersion ?? "latest";
    const fullName = `projects/${config.gcpProjectId}/secrets/${name}/versions/${version}`;
    const c = client;
    try {
        const [response] = await c.accessSecretVersion({ name: fullName });
        const payload = response
            .payload;
        if (!payload?.data)
            return null;
        if (typeof payload.data === "string")
            return payload.data;
        return Buffer.from(payload.data).toString("utf-8");
    }
    catch (err) {
        if (_isGcpNotFound(err))
            return null;
        throw err;
    }
}
async function _azureGetSecret(client, name) {
    const c = client;
    try {
        const resp = await c.getSecret(name);
        return resp.value ?? null;
    }
    catch (err) {
        if (_isAzureNotFound(err))
            return null;
        throw err;
    }
}
// ---------------------------------------------------------------------------
async function _loadOptional(pkg, install) {
    try {
        return (await import(pkg));
    }
    catch (err) {
        const e = err;
        if (e.code === "ERR_MODULE_NOT_FOUND" || e.code === "MODULE_NOT_FOUND") {
            throw new Error(`cloud_secrets: package '${pkg}' is not installed. Run: ${install}`);
        }
        throw err;
    }
}
function _isAwsNotFound(err) {
    const e = err;
    return e.name === "ResourceNotFoundException" || e.Code === "ResourceNotFoundException";
}
function _isGcpNotFound(err) {
    const e = err;
    // grpc status 5 = NOT_FOUND.
    return e.code === 5 || e.code === "5";
}
function _isAzureNotFound(err) {
    const e = err;
    return e.code === "SecretNotFound" || e.statusCode === 404;
}
