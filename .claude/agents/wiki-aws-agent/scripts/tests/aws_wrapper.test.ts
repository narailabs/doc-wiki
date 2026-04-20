/**
 * Tests for aws_wrapper.ts — the wiki-aws-agent wrapper shim.
 *
 * The wrapper spawns the @narai/aws-agent-connector CLI as a subprocess
 * and augments structural responses with Mermaid. These tests point
 * AWS_AGENT_CLI at a tiny fake CLI script so every test deterministically
 * controls the subprocess's stdout/exit code without touching AWS.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { main, resolveAwsAgentCli } from "../aws_wrapper.js";

/** Write a Node script that prints the given JSON to stdout and exits. */
function writeFakeCli(
  tmpDir: string,
  envelope: Record<string, unknown> | string,
  exitCode: number = 0,
): string {
  const payload =
    typeof envelope === "string" ? envelope : JSON.stringify(envelope, null, 2);
  const p = path.join(tmpDir, "fake-cli.js");
  const script = `#!/usr/bin/env node
process.stdout.write(${JSON.stringify(payload)} + "\\n");
process.exit(${exitCode});
`;
  fs.writeFileSync(p, script);
  return p;
}

async function captureStdout(fn: () => void | Promise<void>): Promise<string> {
  const orig = process.stdout.write.bind(process.stdout);
  const chunks: string[] = [];
  process.stdout.write = ((s: string | Uint8Array): boolean => {
    chunks.push(typeof s === "string" ? s : Buffer.from(s).toString("utf-8"));
    return true;
  }) as typeof process.stdout.write;
  try {
    await fn();
  } finally {
    process.stdout.write = orig;
  }
  return chunks.join("");
}

describe("aws_wrapper", () => {
  let tmpDir: string;
  let originalEnv: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aws-wrapper-test-"));
    originalEnv = process.env["AWS_AGENT_CLI"];
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env["AWS_AGENT_CLI"];
    else process.env["AWS_AGENT_CLI"] = originalEnv;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("forwards a plain envelope verbatim when action has no Mermaid augmentation", async () => {
    const envelope = {
      status: "success",
      action: "get_metrics",
      data: {
        region: "us-east-1",
        namespace: "AWS/Lambda",
        metric_name: "Errors",
        dimensions: { FunctionName: "acme" },
        hours: 24,
        datapoints: [],
      },
    };
    process.env["AWS_AGENT_CLI"] = writeFakeCli(tmpDir, envelope);

    const stdout = await captureStdout(async () => {
      const code = await main(["--action", "get_metrics", "--params", "{}"]);
      expect(code).toBe(0);
    });
    const parsed = JSON.parse(stdout);
    expect(parsed).toEqual(envelope);
    expect(parsed.mermaid).toBeUndefined();
  });

  it("attaches a Mermaid graph to list_functions success", async () => {
    const envelope = {
      status: "success",
      action: "list_functions",
      data: {
        region: "us-east-1",
        functions: [
          { name: "hello", runtime: "nodejs20.x", last_modified: "2026-04-01" },
          { name: "world", runtime: "python3.12", last_modified: "2026-04-02" },
        ],
        function_count: 2,
      },
    };
    process.env["AWS_AGENT_CLI"] = writeFakeCli(tmpDir, envelope);

    const stdout = await captureStdout(async () => {
      await main(["--action", "list_functions", "--params", '{"region":"us-east-1"}']);
    });
    const parsed = JSON.parse(stdout);
    expect(parsed.mermaid).toBeDefined();
    expect(parsed.mermaid.code).toContain("graph TB");
    expect(parsed.mermaid.code).toContain("hello");
    expect(parsed.mermaid.code).toContain("world");
    expect(parsed.mermaid.title).toContain("us-east-1");
  });

  it("attaches a Mermaid graph to describe_db success", async () => {
    const envelope = {
      status: "success",
      action: "describe_db",
      data: {
        region: "us-east-1",
        db_identifier: "acme-rds",
        engine: "postgres",
        engine_version: "15.3",
        instance_class: "db.t3.medium",
        status: "available",
        endpoint: "acme.rds",
        storage_gb: 100,
      },
    };
    process.env["AWS_AGENT_CLI"] = writeFakeCli(tmpDir, envelope);

    const stdout = await captureStdout(async () => {
      await main([
        "--action",
        "describe_db",
        "--params",
        '{"region":"us-east-1","db_identifier":"acme-rds"}',
      ]);
    });
    const parsed = JSON.parse(stdout);
    expect(parsed.mermaid).toBeDefined();
    expect(parsed.mermaid.code).toContain("acme-rds");
    expect(parsed.mermaid.code).toContain("postgres");
  });

  it("attaches a Mermaid graph to list_buckets when non-empty", async () => {
    const envelope = {
      status: "success",
      action: "list_buckets",
      data: {
        buckets: [
          { name: "acme-logs", created_at: "2026-01-01T00:00:00.000Z" },
          { name: "acme-data", created_at: "2026-01-02T00:00:00.000Z" },
        ],
        bucket_count: 2,
      },
    };
    process.env["AWS_AGENT_CLI"] = writeFakeCli(tmpDir, envelope);

    const stdout = await captureStdout(async () => {
      await main(["--action", "list_buckets", "--params", "{}"]);
    });
    const parsed = JSON.parse(stdout);
    expect(parsed.mermaid).toBeDefined();
    expect(parsed.mermaid.code).toContain("acme-logs");
    expect(parsed.mermaid.code).toContain("acme-data");
  });

  it("omits Mermaid for list_buckets when empty", async () => {
    const envelope = {
      status: "success",
      action: "list_buckets",
      data: { buckets: [], bucket_count: 0 },
    };
    process.env["AWS_AGENT_CLI"] = writeFakeCli(tmpDir, envelope);

    const stdout = await captureStdout(async () => {
      await main(["--action", "list_buckets", "--params", "{}"]);
    });
    const parsed = JSON.parse(stdout);
    expect(parsed.mermaid).toBeUndefined();
  });

  it("passes through error envelopes without attaching Mermaid", async () => {
    const envelope = {
      status: "error",
      action: "list_functions",
      error_code: "AUTH_ERROR",
      message: "Credentials missing",
    };
    process.env["AWS_AGENT_CLI"] = writeFakeCli(tmpDir, envelope, 1);

    const stdout = await captureStdout(async () => {
      const code = await main(["--action", "list_functions", "--params", "{}"]);
      expect(code).toBe(1);
    });
    const parsed = JSON.parse(stdout);
    expect(parsed.status).toBe("error");
    expect(parsed.mermaid).toBeUndefined();
  });

  it("passes through non-JSON stdout verbatim (help text)", async () => {
    const helpText = "usage: aws-agent-connector [-h] --action ...";
    process.env["AWS_AGENT_CLI"] = writeFakeCli(tmpDir, helpText);

    const stdout = await captureStdout(async () => {
      await main(["--help"]);
    });
    expect(stdout.trim()).toBe(helpText);
  });

  it("emits a helpful error when no connector CLI is available", async () => {
    process.env["AWS_AGENT_CLI"] = path.join(tmpDir, "does-not-exist.js");
    // Also make the dev fallback and plugin cache unreachable for this test.
    // We simulate by pointing AWS_AGENT_CLI at a non-existent file; the
    // resolver then walks the remaining candidates. In a typical dev env,
    // ~/src/connectors/aws-agent-connector/dist/cli.js will be present, so this test
    // is skipped when that fallback exists.
    const devFallback = path.resolve(
      os.homedir(),
      "src/connectors/aws-agent-connector/dist/cli.js",
    );
    if (fs.existsSync(devFallback)) return;

    const origErr = process.stderr.write.bind(process.stderr);
    const errChunks: string[] = [];
    process.stderr.write = ((s: string | Uint8Array): boolean => {
      errChunks.push(
        typeof s === "string" ? s : Buffer.from(s).toString("utf-8"),
      );
      return true;
    }) as typeof process.stderr.write;
    try {
      const code = await main(["--action", "list_functions", "--params", "{}"]);
      expect(code).toBe(2);
      expect(errChunks.join("")).toContain("aws-agent CLI not found");
    } finally {
      process.stderr.write = origErr;
    }
  });
});

describe("resolveAwsAgentCli", () => {
  let originalEnv: string | undefined;
  let originalPluginData: string | undefined;

  beforeEach(() => {
    originalEnv = process.env["AWS_AGENT_CLI"];
    originalPluginData = process.env["CLAUDE_PLUGIN_DATA"];
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env["AWS_AGENT_CLI"];
    else process.env["AWS_AGENT_CLI"] = originalEnv;
    if (originalPluginData === undefined) delete process.env["CLAUDE_PLUGIN_DATA"];
    else process.env["CLAUDE_PLUGIN_DATA"] = originalPluginData;
  });

  it("prefers AWS_AGENT_CLI over everything else", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aws-resolver-"));
    try {
      const fake = path.join(tmpDir, "cli.js");
      fs.writeFileSync(fake, "// fake\n");
      process.env["AWS_AGENT_CLI"] = fake;
      const resolved = resolveAwsAgentCli();
      expect(resolved).toEqual({ command: "node", args: [fake] });
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("falls back to ~/src/connectors/aws-agent-connector/dist/cli.js in dev", () => {
    delete process.env["AWS_AGENT_CLI"];
    delete process.env["CLAUDE_PLUGIN_DATA"];
    const devFallback = path.resolve(
      os.homedir(),
      "src/connectors/aws-agent-connector/dist/cli.js",
    );
    if (!fs.existsSync(devFallback)) {
      // Skip when dev fallback doesn't exist (CI, clean checkout).
      return;
    }
    const resolved = resolveAwsAgentCli();
    expect(resolved?.args[0]).toBe(devFallback);
  });
});
