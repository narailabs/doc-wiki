/**
 * Tests for gcp_wrapper.ts — the wiki-gcp-agent wrapper shim.
 *
 * Mirrors the aws_wrapper test pattern: point GCP_AGENT_CLI at a tiny
 * fake CLI script so every test deterministically controls the
 * subprocess's stdout/exit code without touching GCP.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { main, resolveGcpAgentCli } from "../gcp_wrapper.js";

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

describe("gcp_wrapper", () => {
  let tmpDir: string;
  let originalEnv: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gcp-wrapper-test-"));
    originalEnv = process.env["GCP_AGENT_CLI"];
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env["GCP_AGENT_CLI"];
    else process.env["GCP_AGENT_CLI"] = originalEnv;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("forwards query_logs envelope verbatim (non-structural, no Mermaid)", async () => {
    const envelope = {
      status: "success",
      action: "query_logs",
      data: {
        project_id: "acme-prod-123",
        filter: "severity>=INFO",
        hours: 24,
        entries: [],
        entry_count: 0,
      },
      truncated: false,
    };
    process.env["GCP_AGENT_CLI"] = writeFakeCli(tmpDir, envelope);

    const stdout = await captureStdout(async () => {
      const code = await main(["--action", "query_logs", "--params", "{}"]);
      expect(code).toBe(0);
    });
    const parsed = JSON.parse(stdout);
    expect(parsed).toEqual(envelope);
    expect(parsed.mermaid).toBeUndefined();
  });

  it("attaches Mermaid to list_services success", async () => {
    const envelope = {
      status: "success",
      action: "list_services",
      data: {
        project_id: "acme-prod-123",
        services: [
          { name: "run.googleapis.com", title: "Cloud Run", state: "ENABLED" },
          { name: "pubsub.googleapis.com", title: "Pub/Sub", state: "ENABLED" },
        ],
        service_count: 2,
      },
    };
    process.env["GCP_AGENT_CLI"] = writeFakeCli(tmpDir, envelope);

    const stdout = await captureStdout(async () => {
      await main(["--action", "list_services", "--params", '{"project_id":"acme-prod-123"}']);
    });
    const parsed = JSON.parse(stdout);
    expect(parsed.mermaid).toBeDefined();
    expect(parsed.mermaid.code).toContain("Cloud Run");
    expect(parsed.mermaid.title).toContain("acme-prod-123");
  });

  it("attaches Mermaid to describe_db success", async () => {
    const envelope = {
      status: "success",
      action: "describe_db",
      data: {
        project_id: "acme-prod-123",
        instance_id: "main-db",
        database: "primary",
        engine: "postgres",
        version: "15",
        tier: "db-n1-standard-1",
        region: "us-central1",
        state: "RUNNABLE",
        tables: [],
      },
    };
    process.env["GCP_AGENT_CLI"] = writeFakeCli(tmpDir, envelope);

    const stdout = await captureStdout(async () => {
      await main([
        "--action",
        "describe_db",
        "--params",
        '{"project_id":"acme-prod-123","instance_id":"main-db"}',
      ]);
    });
    const parsed = JSON.parse(stdout);
    expect(parsed.mermaid).toBeDefined();
    expect(parsed.mermaid.code).toContain("main-db");
    expect(parsed.mermaid.code).toContain("postgres");
  });

  it("attaches Mermaid to list_topics when topics present", async () => {
    const envelope = {
      status: "success",
      action: "list_topics",
      data: {
        project_id: "acme-prod-123",
        topics: [
          "projects/acme-prod-123/topics/events",
          "projects/acme-prod-123/topics/alerts",
        ],
        topic_count: 2,
      },
    };
    process.env["GCP_AGENT_CLI"] = writeFakeCli(tmpDir, envelope);

    const stdout = await captureStdout(async () => {
      await main(["--action", "list_topics", "--params", '{"project_id":"acme-prod-123"}']);
    });
    const parsed = JSON.parse(stdout);
    expect(parsed.mermaid).toBeDefined();
    expect(parsed.mermaid.code).toContain("events");
    expect(parsed.mermaid.code).toContain("alerts");
  });

  it("omits Mermaid for list_topics when empty", async () => {
    const envelope = {
      status: "success",
      action: "list_topics",
      data: { project_id: "acme-prod-123", topics: [], topic_count: 0 },
    };
    process.env["GCP_AGENT_CLI"] = writeFakeCli(tmpDir, envelope);

    const stdout = await captureStdout(async () => {
      await main(["--action", "list_topics", "--params", '{"project_id":"acme-prod-123"}']);
    });
    const parsed = JSON.parse(stdout);
    expect(parsed.mermaid).toBeUndefined();
  });

  it("passes through error envelopes without Mermaid", async () => {
    const envelope = {
      status: "error",
      action: "list_services",
      error_code: "CONFIG_ERROR",
      message: "gcloud not available",
    };
    process.env["GCP_AGENT_CLI"] = writeFakeCli(tmpDir, envelope, 1);

    const stdout = await captureStdout(async () => {
      const code = await main(["--action", "list_services", "--params", "{}"]);
      expect(code).toBe(1);
    });
    const parsed = JSON.parse(stdout);
    expect(parsed.status).toBe("error");
    expect(parsed.mermaid).toBeUndefined();
  });
});

describe("resolveGcpAgentCli", () => {
  let originalEnv: string | undefined;
  let originalPluginData: string | undefined;

  beforeEach(() => {
    originalEnv = process.env["GCP_AGENT_CLI"];
    originalPluginData = process.env["CLAUDE_PLUGIN_DATA"];
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env["GCP_AGENT_CLI"];
    else process.env["GCP_AGENT_CLI"] = originalEnv;
    if (originalPluginData === undefined) delete process.env["CLAUDE_PLUGIN_DATA"];
    else process.env["CLAUDE_PLUGIN_DATA"] = originalPluginData;
  });

  it("prefers GCP_AGENT_CLI over everything else", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gcp-resolver-"));
    try {
      const fake = path.join(tmpDir, "cli.js");
      fs.writeFileSync(fake, "// fake\n");
      process.env["GCP_AGENT_CLI"] = fake;
      const resolved = resolveGcpAgentCli();
      expect(resolved).toEqual({ command: "node", args: [fake] });
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
