/**
 * Tests for confluence_wrapper.ts — uses fake CLI via CONFLUENCE_AGENT_CLI.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { main } from "../confluence_wrapper.js";

function writeFakeCli(
  tmpDir: string,
  envelope: Record<string, unknown> | string,
  exitCode: number = 0,
): string {
  const payload =
    typeof envelope === "string" ? envelope : JSON.stringify(envelope, null, 2);
  const p = path.join(tmpDir, "fake-cli.js");
  fs.writeFileSync(
    p,
    `#!/usr/bin/env node
process.stdout.write(${JSON.stringify(payload)} + "\\n");
process.exit(${exitCode});
`,
  );
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

describe("confluence_wrapper", () => {
  let tmpDir: string;
  let originalEnv: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "confluence-wrapper-test-"));
    originalEnv = process.env["CONFLUENCE_AGENT_CLI"];
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env["CONFLUENCE_AGENT_CLI"];
    else process.env["CONFLUENCE_AGENT_CLI"] = originalEnv;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("attaches Mermaid to cql_search success", async () => {
    const envelope = {
      status: "success",
      action: "cql_search",
      data: {
        pages: [
          { id: "1", title: "Architecture", space_key: "DEV" },
          { id: "2", title: "Runbook", space_key: "DEV" },
        ],
      },
    };
    process.env["CONFLUENCE_AGENT_CLI"] = writeFakeCli(tmpDir, envelope);

    const stdout = await captureStdout(async () => {
      await main(["--action", "cql_search", "--params", '{"cql":"space = DEV"}']);
    });
    const parsed = JSON.parse(stdout);
    expect(parsed.mermaid).toBeDefined();
    expect(parsed.mermaid.code).toContain("DEV");
    expect(parsed.mermaid.code).toContain("Architecture");
  });

  it("forwards get_space verbatim (non-structural)", async () => {
    const envelope = {
      status: "success",
      action: "get_space",
      data: { key: "DEV", name: "Development" },
    };
    process.env["CONFLUENCE_AGENT_CLI"] = writeFakeCli(tmpDir, envelope);

    const stdout = await captureStdout(async () => {
      await main(["--action", "get_space", "--params", '{"space_key":"DEV"}']);
    });
    const parsed = JSON.parse(stdout);
    expect(parsed).toEqual(envelope);
    expect(parsed.mermaid).toBeUndefined();
  });

  it("omits Mermaid when cql_search returns no pages", async () => {
    const envelope = {
      status: "success",
      action: "cql_search",
      data: { pages: [] },
    };
    process.env["CONFLUENCE_AGENT_CLI"] = writeFakeCli(tmpDir, envelope);

    const stdout = await captureStdout(async () => {
      await main(["--action", "cql_search", "--params", '{"cql":"space = X"}']);
    });
    const parsed = JSON.parse(stdout);
    expect(parsed.mermaid).toBeUndefined();
  });
});
