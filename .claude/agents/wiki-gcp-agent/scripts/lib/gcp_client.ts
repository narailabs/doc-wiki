/**
 * gcp_client.ts — read-only GCP facade that shells out to `gcloud` / `bq`
 * with Application Default Credentials.
 *
 * Security notes:
 * - Uses `execFileSync` — **never** a shell string — so arguments are not
 *   word-split or glob-expanded.
 * - Enforces a whitelist of permitted commands; anything else raises.
 * - Validates project IDs and flag values against conservative regexes.
 * - Read-only flags enforced at the argv level: for example `bq query`
 *   always runs with `--use_legacy_sql=false --max_rows=…`.
 */
import {
  execFileSync,
  type ExecFileSyncOptionsWithStringEncoding,
} from "node:child_process";

type CommandRunner = (
  file: string,
  args: string[],
  options: ExecFileSyncOptionsWithStringEncoding,
) => string;

const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
const DEFAULT_READ_TIMEOUT_MS = 30_000;
const DEFAULT_RATE_LIMIT_PER_MIN = 60;

const ALLOWED_BINARIES: ReadonlySet<string> = new Set(["gcloud", "bq"]);

// Only these sub-commands may be invoked by the client.
const ALLOWED_SUBCOMMANDS: ReadonlySet<string> = new Set([
  "gcloud services list",
  "gcloud sql instances describe",
  "gcloud pubsub topics list",
  "gcloud logging read",
  "bq query",
]);

const PROJECT_ID_SAFE = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const ALPHANUM_DASH = /^[a-zA-Z0-9._-]+$/;

export interface GcpClientOptions {
  rateLimitPerMin?: number;
  connectTimeoutMs?: number;
  readTimeoutMs?: number;
  runner?: CommandRunner;
  sleepImpl?: (ms: number) => Promise<void>;
}

export interface GcpErrorPayload {
  ok: false;
  code: string;
  message: string;
  retriable: boolean;
}
export interface GcpSuccessPayload<T> {
  ok: true;
  data: T;
}
export type GcpResult<T> = GcpSuccessPayload<T> | GcpErrorPayload;

export class GcpClient {
  private readonly _rateLimitPerMin: number;
  private readonly _connectTimeoutMs: number;
  private readonly _readTimeoutMs: number;
  private readonly _runner: CommandRunner;
  private readonly _sleep: (ms: number) => Promise<void>;
  private _timestamps: number[] = [];

  constructor(opts: GcpClientOptions = {}) {
    this._rateLimitPerMin = opts.rateLimitPerMin ?? DEFAULT_RATE_LIMIT_PER_MIN;
    this._connectTimeoutMs = opts.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
    this._readTimeoutMs = opts.readTimeoutMs ?? DEFAULT_READ_TIMEOUT_MS;
    this._runner = opts.runner ?? execFileSync;
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

  private _run(
    binary: "gcloud" | "bq",
    subcommand: string,
    args: string[],
  ): GcpResult<string> {
    if (!ALLOWED_BINARIES.has(binary)) {
      return {
        ok: false,
        code: "FORBIDDEN_BINARY",
        message: `Binary ${binary} is not permitted`,
        retriable: false,
      };
    }
    if (!ALLOWED_SUBCOMMANDS.has(`${binary} ${subcommand}`)) {
      return {
        ok: false,
        code: "FORBIDDEN_COMMAND",
        message: `Command not whitelisted: ${binary} ${subcommand}`,
        retriable: false,
      };
    }
    // Block shell metacharacters in every arg — execFile avoids the shell
    // but a belt-and-braces validation short-circuits any future leakage.
    //
    // `bq query` accepts the SQL body as the final positional argument;
    // that content is validated at the call site (bqQuery) and may
    // legitimately contain `;` inside string literals or as a single
    // trailing terminator, so we skip the blocklist for it specifically.
    const isBqQuery = binary === "bq" && subcommand === "query";
    const lastIndex = args.length - 1;
    for (let idx = 0; idx < args.length; idx++) {
      if (isBqQuery && idx === lastIndex) continue;
      const arg = args[idx] ?? "";
      if (/[;|&`$<>\n]/.test(arg)) {
        return {
          ok: false,
          code: "UNSAFE_ARG",
          message: `Refusing unsafe argument: ${arg}`,
          retriable: false,
        };
      }
    }
    try {
      const stdout = this._runner(binary, [...subcommand.split(" "), ...args], {
        encoding: "utf-8",
        timeout: this._connectTimeoutMs + this._readTimeoutMs,
        maxBuffer: 16 * 1024 * 1024,
      });
      return { ok: true, data: stdout };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        code: /timeout/i.test(message) ? "TIMEOUT" : "EXEC_ERROR",
        message,
        retriable: /timeout|ECONNRESET/i.test(message),
      };
    }
  }

  public async listServices(
    projectId: string,
  ): Promise<GcpResult<GcpServiceRecord[]>> {
    if (!PROJECT_ID_SAFE.test(projectId)) {
      return {
        ok: false,
        code: "INVALID_PROJECT",
        message: `Invalid project_id '${projectId}'`,
        retriable: false,
      };
    }
    await this._throttle();
    const raw = this._run("gcloud", "services list", [
      "--project",
      projectId,
      "--enabled",
      "--format=json",
    ]);
    if (!raw.ok) return raw;
    return parseJsonArray<GcpServiceRecord>(raw.data);
  }

  public async describeSqlInstance(
    projectId: string,
    instanceId: string,
  ): Promise<GcpResult<GcpSqlInstance>> {
    if (!PROJECT_ID_SAFE.test(projectId)) {
      return {
        ok: false,
        code: "INVALID_PROJECT",
        message: `Invalid project_id '${projectId}'`,
        retriable: false,
      };
    }
    if (!ALPHANUM_DASH.test(instanceId)) {
      return {
        ok: false,
        code: "INVALID_INSTANCE",
        message: `Invalid instance_id '${instanceId}'`,
        retriable: false,
      };
    }
    await this._throttle();
    const raw = this._run("gcloud", "sql instances describe", [
      instanceId,
      "--project",
      projectId,
      "--format=json",
    ]);
    if (!raw.ok) return raw;
    return parseJsonObject<GcpSqlInstance>(raw.data);
  }

  public async listPubsubTopics(
    projectId: string,
  ): Promise<GcpResult<GcpTopic[]>> {
    if (!PROJECT_ID_SAFE.test(projectId)) {
      return {
        ok: false,
        code: "INVALID_PROJECT",
        message: `Invalid project_id '${projectId}'`,
        retriable: false,
      };
    }
    await this._throttle();
    const raw = this._run("gcloud", "pubsub topics list", [
      "--project",
      projectId,
      "--format=json",
    ]);
    if (!raw.ok) return raw;
    return parseJsonArray<GcpTopic>(raw.data);
  }

  public async queryLogs(
    projectId: string,
    filter: string,
    hours: number,
    maxResults: number,
  ): Promise<GcpResult<GcpLogEntry[]>> {
    if (!PROJECT_ID_SAFE.test(projectId)) {
      return {
        ok: false,
        code: "INVALID_PROJECT",
        message: `Invalid project_id '${projectId}'`,
        retriable: false,
      };
    }
    if (/[;'"\n]/.test(filter)) {
      return {
        ok: false,
        code: "INVALID_FILTER",
        message: "Filter contains forbidden characters",
        retriable: false,
      };
    }
    if (!Number.isFinite(hours) || hours <= 0 || hours > 168) {
      return {
        ok: false,
        code: "INVALID_FILTER",
        message: "hours must be in (0, 168]",
        retriable: false,
      };
    }
    await this._throttle();
    const raw = this._run("gcloud", "logging read", [
      filter,
      "--project",
      projectId,
      "--limit",
      String(Math.min(Math.max(1, Math.trunc(maxResults)), 1000)),
      "--freshness",
      `${Math.trunc(hours)}h`,
      "--format=json",
    ]);
    if (!raw.ok) return raw;
    return parseJsonArray<GcpLogEntry>(raw.data);
  }

  public async bqQuery(
    projectId: string,
    sql: string,
    maxRows: number,
  ): Promise<GcpResult<GcpBqResult>> {
    if (!PROJECT_ID_SAFE.test(projectId)) {
      return {
        ok: false,
        code: "INVALID_PROJECT",
        message: `Invalid project_id '${projectId}'`,
        retriable: false,
      };
    }
    if (!/^\s*SELECT\b/i.test(sql)) {
      return {
        ok: false,
        code: "WRITE_FORBIDDEN",
        message: "Only SELECT statements are permitted",
        retriable: false,
      };
    }
    // Reject multi-statement scripts. BigQuery accepts scripts like
    // `SELECT 1; DROP TABLE x` when `--use_legacy_sql=false`, so a
    // SELECT-prefix check alone is not enough. Strip quoted string
    // literals first so legitimate semicolons inside strings pass.
    const stripped = stripSqlStringLiterals(sql);
    const trailingStripped = stripped.replace(/\s*;\s*$/, "");
    if (trailingStripped.includes(";")) {
      return {
        ok: false,
        code: "WRITE_FORBIDDEN",
        message: "Multi-statement scripts are not permitted",
        retriable: false,
      };
    }
    await this._throttle();
    const raw = this._run("bq", "query", [
      `--project_id=${projectId}`,
      "--use_legacy_sql=false",
      `--max_rows=${Math.max(1, Math.trunc(maxRows))}`,
      "--format=json",
      "--quiet",
      sql,
    ]);
    if (!raw.ok) return raw;
    const parsed = parseJsonArray<Record<string, unknown>>(raw.data);
    if (!parsed.ok) return parsed;
    return { ok: true, data: { rows: parsed.data, row_count: parsed.data.length } };
  }
}

export interface GcpServiceRecord {
  name?: string;
  config?: { title?: string };
  state?: string;
}

export interface GcpSqlInstance {
  name?: string;
  databaseVersion?: string;
  settings?: { tier?: string };
  region?: string;
  state?: string;
  connectionName?: string;
}

export interface GcpTopic {
  name?: string;
}

export interface GcpLogEntry {
  timestamp?: string;
  severity?: string;
  textPayload?: string;
  jsonPayload?: Record<string, unknown>;
}

export interface GcpBqResult {
  rows: Array<Record<string, unknown>>;
  row_count: number;
}

function parseJsonArray<T>(raw: string): GcpResult<T[]> {
  try {
    const trimmed = raw.trim() || "[]";
    const parsed = JSON.parse(trimmed) as unknown;
    if (!Array.isArray(parsed)) {
      return {
        ok: false,
        code: "PARSE_ERROR",
        message: "Expected JSON array from gcloud output",
        retriable: false,
      };
    }
    return { ok: true, data: parsed as T[] };
  } catch (err) {
    return {
      ok: false,
      code: "PARSE_ERROR",
      message: `Failed to parse JSON: ${(err as Error).message}`,
      retriable: false,
    };
  }
}

function parseJsonObject<T>(raw: string): GcpResult<T> {
  try {
    const parsed = JSON.parse(raw.trim()) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        ok: false,
        code: "PARSE_ERROR",
        message: "Expected JSON object from gcloud output",
        retriable: false,
      };
    }
    return { ok: true, data: parsed as T };
  } catch (err) {
    return {
      ok: false,
      code: "PARSE_ERROR",
      message: `Failed to parse JSON: ${(err as Error).message}`,
      retriable: false,
    };
  }
}

/**
 * Replace SQL string literals with empty markers so downstream semicolon
 * detection ignores any `;` that lives inside a quoted string.
 * Handles single-quoted, double-quoted, and backtick-quoted runs; SQL-style
 * `''` / `""` escapes are consumed as part of the enclosing literal.
 */
function stripSqlStringLiterals(sql: string): string {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    if (ch === "'" || ch === '"' || ch === "`") {
      const quote = ch;
      i++;
      while (i < sql.length) {
        if (sql[i] === quote) {
          if (sql[i + 1] === quote) {
            i += 2;
            continue;
          }
          i++;
          break;
        }
        if (sql[i] === "\\" && i + 1 < sql.length) {
          i += 2;
          continue;
        }
        i++;
      }
      out += " ";
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/** Detect whether gcloud/bq are available on PATH. Returns `null` on detection failure. */
export function detectGcloudAvailable(
  runner: CommandRunner = execFileSync,
): boolean {
  try {
    runner("gcloud", ["--version"], {
      encoding: "utf-8",
      timeout: 5000,
      maxBuffer: 1024 * 1024,
    });
    return true;
  } catch {
    return false;
  }
}
