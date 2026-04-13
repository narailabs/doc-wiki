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

const ALLOWED_COMMANDS: ReadonlySet<string> = new Set([
  "DescribeDBInstancesCommand",
  "ListTablesCommand",
  "DescribeTableCommand",
  "ListBucketsCommand",
  "GetMetricStatisticsCommand",
  "ListFunctionsCommand",
]);

interface AwsSdkClient {
  send(command: { __name__?: string } & Record<string, unknown>): Promise<unknown>;
}

type SdkFactory = (config: { region?: string }) => AwsSdkClient;

/** Labeled command constructor used by the client to enforce the whitelist. */
export interface AwsCommand {
  name: string;
  input: Record<string, unknown>;
}

export interface AwsSdkFactories {
  rds?: SdkFactory;
  dynamodb?: SdkFactory;
  s3?: SdkFactory;
  cloudwatch?: SdkFactory;
  lambda?: SdkFactory;
}

export interface AwsClientOptions {
  region: string;
  factories: AwsSdkFactories;
  rateLimitPerMin?: number;
  connectTimeoutMs?: number;
  readTimeoutMs?: number;
  sleepImpl?: (ms: number) => Promise<void>;
}

export interface AwsErrorPayload {
  ok: false;
  code: string;
  message: string;
  retriable: boolean;
}
export interface AwsSuccessPayload<T> {
  ok: true;
  data: T;
}
export type AwsResult<T> = AwsSuccessPayload<T> | AwsErrorPayload;

export async function loadAwsCredentialsOverride(): Promise<
  { accessKeyId: string; secretAccessKey: string } | null
> {
  const accessKeyId =
    (await resolveSecret("AWS_ACCESS_KEY_ID")) ??
    process.env["AWS_ACCESS_KEY_ID"] ??
    null;
  const secretAccessKey =
    (await resolveSecret("AWS_SECRET_ACCESS_KEY")) ??
    process.env["AWS_SECRET_ACCESS_KEY"] ??
    null;
  if (!accessKeyId || !secretAccessKey) return null;
  return { accessKeyId, secretAccessKey };
}

export class AwsClient {
  private readonly _region: string;
  private readonly _factories: AwsSdkFactories;
  private readonly _rateLimitPerMin: number;
  private readonly _connectTimeoutMs: number;
  private readonly _readTimeoutMs: number;
  private readonly _sleep: (ms: number) => Promise<void>;
  private _timestamps: number[] = [];

  constructor(opts: AwsClientOptions) {
    this._region = opts.region;
    this._factories = opts.factories;
    this._rateLimitPerMin = opts.rateLimitPerMin ?? DEFAULT_RATE_LIMIT_PER_MIN;
    this._connectTimeoutMs = opts.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
    this._readTimeoutMs = opts.readTimeoutMs ?? DEFAULT_READ_TIMEOUT_MS;
    this._sleep =
      opts.sleepImpl ??
      ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  }

  private async _throttle(): Promise<void> {
    const now = Date.now();
    const cutoff = now - 60_000;
    this._timestamps = this._timestamps.filter((t) => t > cutoff);
    if (this._timestamps.length >= this._rateLimitPerMin) {
      const oldest = this._timestamps[0] ?? now;
      const waitMs = Math.max(0, 60_000 - (now - oldest));
      if (waitMs > 0) await this._sleep(waitMs);
      this._timestamps = this._timestamps.filter(
        (t) => t > Date.now() - 60_000,
      );
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
  public async send<T = unknown>(
    factoryKey: keyof AwsSdkFactories,
    command: AwsCommand,
  ): Promise<AwsResult<T>> {
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
        new Promise<never>((_resolve, reject) =>
          setTimeout(() => reject(new Error("Request timed out")), timeoutMs),
        ),
      ]);
      return { ok: true, data: race as T };
    } catch (err) {
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

  public async describeDBInstances(
    filter?: { DBInstanceIdentifier?: string },
  ): Promise<AwsResult<{ DBInstances?: AwsDBInstance[] }>> {
    return this.send<{ DBInstances?: AwsDBInstance[] }>("rds", {
      name: "DescribeDBInstancesCommand",
      input: filter ?? {},
    });
  }

  public async listTables(): Promise<AwsResult<{ TableNames?: string[] }>> {
    return this.send<{ TableNames?: string[] }>("dynamodb", {
      name: "ListTablesCommand",
      input: {},
    });
  }

  public async describeTable(
    name: string,
  ): Promise<AwsResult<{ Table?: AwsDynamoTable }>> {
    return this.send<{ Table?: AwsDynamoTable }>("dynamodb", {
      name: "DescribeTableCommand",
      input: { TableName: name },
    });
  }

  public async listBuckets(): Promise<AwsResult<{ Buckets?: AwsBucket[] }>> {
    return this.send<{ Buckets?: AwsBucket[] }>("s3", {
      name: "ListBucketsCommand",
      input: {},
    });
  }

  public async listLambdaFunctions(): Promise<
    AwsResult<{ Functions?: AwsLambdaFunction[] }>
  > {
    return this.send<{ Functions?: AwsLambdaFunction[] }>("lambda", {
      name: "ListFunctionsCommand",
      input: {},
    });
  }

  public async getMetricStatistics(input: {
    Namespace: string;
    MetricName: string;
    Dimensions?: Array<{ Name: string; Value: string }>;
    StartTime: Date;
    EndTime: Date;
    Period: number;
    Statistics: string[];
  }): Promise<AwsResult<{ Datapoints?: AwsDatapoint[] }>> {
    return this.send<{ Datapoints?: AwsDatapoint[] }>("cloudwatch", {
      name: "GetMetricStatisticsCommand",
      input,
    });
  }
}

export interface AwsDBInstance {
  DBInstanceIdentifier?: string;
  Engine?: string;
  EngineVersion?: string;
  DBInstanceClass?: string;
  DBInstanceStatus?: string;
  Endpoint?: { Address?: string; Port?: number };
  AllocatedStorage?: number;
}

export interface AwsDynamoTable {
  TableName?: string;
  TableStatus?: string;
  KeySchema?: Array<{ AttributeName?: string; KeyType?: string }>;
  AttributeDefinitions?: Array<{
    AttributeName?: string;
    AttributeType?: string;
  }>;
  ItemCount?: number;
  TableSizeBytes?: number;
}

export interface AwsBucket {
  Name?: string;
  CreationDate?: Date | string;
}

export interface AwsLambdaFunction {
  FunctionName?: string;
  Runtime?: string;
  LastModified?: string;
}

export interface AwsDatapoint {
  Timestamp?: Date | string;
  Sum?: number;
  Average?: number;
  Maximum?: number;
}

function classifyAwsError(err: unknown): string {
  if (err && typeof err === "object" && "name" in err) {
    const name = String((err as { name: unknown }).name ?? "");
    if (/NotFound|NoSuch/.test(name)) return "NOT_FOUND";
    if (/Unauthorized|InvalidSignature|Credentials/i.test(name))
      return "AUTH_ERROR";
    if (/Throttl|Rate/i.test(name)) return "RATE_LIMITED";
  }
  return "SDK_ERROR";
}
