/**
 * Tests for github_wrapper.ts — fake CLI via GITHUB_AGENT_CLI.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { main } from "../github_wrapper.js";

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

describe("github_wrapper", () => {
  let tmpDir: string;
  let originalEnv: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "github-wrapper-test-"));
    originalEnv = process.env["GITHUB_AGENT_CLI"];
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env["GITHUB_AGENT_CLI"];
    else process.env["GITHUB_AGENT_CLI"] = originalEnv;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("attaches Mermaid dep graph to get_file(package.json)", async () => {
    const envelope = {
      status: "success",
      action: "get_file",
      data: {
        path: "package.json",
        content: JSON.stringify({
          name: "demo",
          dependencies: { react: "^18", lodash: "^4" },
        }),
      },
    };
    process.env["GITHUB_AGENT_CLI"] = writeFakeCli(tmpDir, envelope);

    const stdout = await captureStdout(async () => {
      await main([
        "--action",
        "get_file",
        "--params",
        '{"owner":"a","repo":"b","path":"package.json"}',
      ]);
    });
    const parsed = JSON.parse(stdout);
    expect(parsed.mermaid).toBeDefined();
    expect(parsed.mermaid.code).toContain("react");
    expect(parsed.mermaid.code).toContain("lodash");
  });

  it("omits Mermaid for get_file on non-manifest files", async () => {
    const envelope = {
      status: "success",
      action: "get_file",
      data: { path: "README.md", content: "hello" },
    };
    process.env["GITHUB_AGENT_CLI"] = writeFakeCli(tmpDir, envelope);

    const stdout = await captureStdout(async () => {
      await main([
        "--action",
        "get_file",
        "--params",
        '{"owner":"a","repo":"b","path":"README.md"}',
      ]);
    });
    const parsed = JSON.parse(stdout);
    expect(parsed.mermaid).toBeUndefined();
  });

  it("forwards repo_info verbatim (non-structural)", async () => {
    const envelope = {
      status: "success",
      action: "repo_info",
      data: { full_name: "a/b", stars: 10 },
    };
    process.env["GITHUB_AGENT_CLI"] = writeFakeCli(tmpDir, envelope);

    const stdout = await captureStdout(async () => {
      await main(["--action", "repo_info", "--params", '{"owner":"a","repo":"b"}']);
    });
    const parsed = JSON.parse(stdout);
    expect(parsed).toEqual(envelope);
    expect(parsed.mermaid).toBeUndefined();
  });
});
