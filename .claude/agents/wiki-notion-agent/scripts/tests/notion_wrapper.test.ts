/**
 * Tests for notion_wrapper.ts — the wiki-notion-agent wrapper shim.
 *
 * Same fake-CLI pattern as aws_wrapper/gcp_wrapper tests.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { main } from "../notion_wrapper.js";

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

describe("notion_wrapper", () => {
  let tmpDir: string;
  let originalEnv: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "notion-wrapper-test-"));
    originalEnv = process.env["NOTION_AGENT_CLI"];
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env["NOTION_AGENT_CLI"];
    else process.env["NOTION_AGENT_CLI"] = originalEnv;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("attaches Mermaid to a non-empty search envelope", async () => {
    const envelope = {
      status: "success",
      action: "search",
      data: {
        results: [
          { id: "p1-abcd", object_type: "page" },
          { id: "d2-efgh", object_type: "database" },
        ],
        has_more: false,
      },
    };
    process.env["NOTION_AGENT_CLI"] = writeFakeCli(tmpDir, envelope);

    const stdout = await captureStdout(async () => {
      await main(["--action", "search", "--params", '{"query":"arch"}']);
    });
    const parsed = JSON.parse(stdout);
    expect(parsed.mermaid).toBeDefined();
    expect(parsed.mermaid.code).toContain("Search Results");
  });

  it("omits Mermaid when search returns no results", async () => {
    const envelope = {
      status: "success",
      action: "search",
      data: { results: [], has_more: false },
    };
    process.env["NOTION_AGENT_CLI"] = writeFakeCli(tmpDir, envelope);

    const stdout = await captureStdout(async () => {
      await main(["--action", "search", "--params", '{"query":"none"}']);
    });
    const parsed = JSON.parse(stdout);
    expect(parsed.mermaid).toBeUndefined();
  });

  it("forwards get_page verbatim (non-structural)", async () => {
    const envelope = {
      status: "success",
      action: "get_page",
      data: { id: "abc", title: "Page" },
    };
    process.env["NOTION_AGENT_CLI"] = writeFakeCli(tmpDir, envelope);

    const stdout = await captureStdout(async () => {
      await main(["--action", "get_page", "--params", '{"page_id":"abc"}']);
    });
    const parsed = JSON.parse(stdout);
    expect(parsed).toEqual(envelope);
    expect(parsed.mermaid).toBeUndefined();
  });

  it("passes through error envelopes without Mermaid", async () => {
    const envelope = {
      status: "error",
      action: "search",
      error_code: "AUTH_ERROR",
      message: "Missing NOTION_TOKEN",
    };
    process.env["NOTION_AGENT_CLI"] = writeFakeCli(tmpDir, envelope, 1);

    const stdout = await captureStdout(async () => {
      const code = await main(["--action", "search", "--params", '{"query":"x"}']);
      expect(code).toBe(1);
    });
    const parsed = JSON.parse(stdout);
    expect(parsed.status).toBe("error");
    expect(parsed.mermaid).toBeUndefined();
  });
});
