/**
 * aws_client.ts — read-only AWS SDK v3 facade.
 *
 * Rather than hard-depend on `@aws-sdk/client-rds` / `-s3` / `-dynamodb` at
 * import time (the packages are optional in this repo), the client accepts
 * dependency-injected `sdkFactory` callables that produce
 * { send: async (cmd) => … } shapes — matching the runtime contract of
 * every modular SDK v3 client. Tests inject fake sdkFactories; production
 * callers import the real SDK modules and pass them in.
 *
 * Only whitelisted read-only *Command types are exposed here.
 */
import { resolveSecret } from "../../../lib/credential_providers/index.js";
const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
const DEFAULT_READ_TIMEOUT_MS = 30_000;
const DEFAULT_RATE_LIMIT_PER_MIN = 60;
const ALLOWED_COMMANDS = new Set([
    "DescribeDBInstancesCommand",
    "ListTablesCommand",
    "DescribeTableCommand",
    "ListBucketsCommand",
    "GetMetricStatisticsCommand",
    "ListFunctionsCommand",
]);
export async function loadAwsCredentialsOverride() {
    const accessKeyId = (await resolveSecret("AWS_ACCESS_KEY_ID")) ??
        process.env["AWS_ACCESS_KEY_ID"] ??
        null;
    const secretAccessKey = (await resolveSecret("AWS_SECRET_ACCESS_KEY")) ??
        process.env["AWS_SECRET_ACCESS_KEY"] ??
        null;
    if (!accessKeyId || !secretAccessKey)
        return null;
    return { accessKeyId, secretAccessKey };
}
export class AwsClient {
    _region;
    _factories;
    _rateLimitPerMin;
    _connectTimeoutMs;
    _readTimeoutMs;
    _sleep;
    _timestamps = [];
    constructor(opts) {
        this._region = opts.region;
        this._factories = opts.factories;
        this._rateLimitPerMin = opts.rateLimitPerMin ?? DEFAULT_RATE_LIMIT_PER_MIN;
        this._connectTimeoutMs = opts.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
        this._readTimeoutMs = opts.readTimeoutMs ?? DEFAULT_READ_TIMEOUT_MS;
        this._sleep =
            opts.sleepImpl ??
                ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    }
    async _throttle() {
        const now = Date.now();
        const cutoff = now - 60_000;
        this._timestamps = this._timestamps.filter((t) => t > cutoff);
        if (this._timestamps.length >= this._rateLimitPerMin) {
            const oldest = this._timestamps[0] ?? now;
            const waitMs = Math.max(0, 60_000 - (now - oldest));
            if (waitMs > 0)
                await this._sleep(waitMs);
            this._timestamps = this._timestamps.filter((t) => t > Date.now() - 60_000);
        }
        this._timestamps.push(Date.now());
    }
    /**
     * Send a whitelisted command via an SDK factory.
     *
     * Named tagged commands (rather than real SDK classes) keep the client
     * free of SDK imports. Each factory produces a client that exposes
     * `.send(command)` — the `__name__` is attached so the whitelist can
     * gate the call centrally.
     */
    async send(factoryKey, command) {
        if (!ALLOWED_COMMANDS.has(command.name)) {
            return {
                ok: false,
                code: "METHOD_NOT_ALLOWED",
                message: `Command ${command.name} is not on the read-only whitelist`,
                retriable: false,
            };
        }
        const factory = this._factories[factoryKey];
        if (!factory) {
            return {
                ok: false,
                code: "SDK_UNAVAILABLE",
                message: `AWS SDK client missing for ${factoryKey}`,
                retriable: false,
            };
        }
        await this._throttle();
        try {
            const sdk = factory({ region: this._region });
            const wrapped = {
                ...command.input,
                __name__: command.name,
            };
            const timeoutMs = this._connectTimeoutMs + this._readTimeoutMs;
            const race = await Promise.race([
                sdk.send(wrapped),
                new Promise((_resolve, reject) => setTimeout(() => reject(new Error("Request timed out")), timeoutMs)),
            ]);
            return { ok: true, data: race };
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            const timeout = /timed out/i.test(message);
            return {
                ok: false,
                code: timeout ? "TIMEOUT" : classifyAwsError(err),
                message,
                retriable: /timeout|Throttl|ECONNRESET/i.test(message),
            };
        }
    }
    async describeDBInstances(filter) {
        return this.send("rds", {
            name: "DescribeDBInstancesCommand",
            input: filter ?? {},
        });
    }
    async listTables() {
        return this.send("dynamodb", {
            name: "ListTablesCommand",
            input: {},
        });
    }
    async describeTable(name) {
        return this.send("dynamodb", {
            name: "DescribeTableCommand",
            input: { TableName: name },
        });
    }
    async listBuckets() {
        return this.send("s3", {
            name: "ListBucketsCommand",
            input: {},
        });
    }
    async listLambdaFunctions() {
        return this.send("lambda", {
            name: "ListFunctionsCommand",
            input: {},
        });
    }
    async getMetricStatistics(input) {
        return this.send("cloudwatch", {
            name: "GetMetricStatisticsCommand",
            input,
        });
    }
}
function classifyAwsError(err) {
    if (err && typeof err === "object" && "name" in err) {
        const name = String(err.name ?? "");
        if (/NotFound|NoSuch/.test(name))
            return "NOT_FOUND";
        if (/Unauthorized|InvalidSignature|Credentials/i.test(name))
            return "AUTH_ERROR";
        if (/Throttl|Rate/i.test(name))
            return "RATE_LIMITED";
    }
    return "SDK_ERROR";
}
