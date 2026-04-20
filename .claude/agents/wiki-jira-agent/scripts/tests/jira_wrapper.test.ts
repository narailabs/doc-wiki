/**
 * Tests for jira_wrapper.ts — fake CLI via JIRA_AGENT_CLI.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { main } from "../jira_wrapper.js";

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

describe("jira_wrapper", () => {
  let tmpDir: string;
  let originalEnv: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "jira-wrapper-test-"));
    originalEnv = process.env["JIRA_AGENT_CLI"];
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env["JIRA_AGENT_CLI"];
    else process.env["JIRA_AGENT_CLI"] = originalEnv;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("attaches a status-grouped Mermaid to jql_search success", async () => {
    const envelope = {
      status: "success",
      action: "jql_search",
      data: {
        issues: [
          { key: "FOO-1", summary: "fix login", status: "Done" },
          { key: "FOO-2", summary: "add search", status: "In Progress" },
        ],
      },
    };
    process.env["JIRA_AGENT_CLI"] = writeFakeCli(tmpDir, envelope);

    const stdout = await captureStdout(async () => {
      await main(["--action", "jql_search", "--params", '{"jql":"project = FOO"}']);
    });
    const parsed = JSON.parse(stdout);
    expect(parsed.mermaid).toBeDefined();
    expect(parsed.mermaid.code).toContain("Done");
    expect(parsed.mermaid.code).toContain("In Progress");
    expect(parsed.mermaid.code).toContain("FOO-1");
  });

  it("forwards get_issue verbatim (non-structural)", async () => {
    const envelope = {
      status: "success",
      action: "get_issue",
      data: { key: "FOO-1", summary: "x", status: "Open" },
    };
    process.env["JIRA_AGENT_CLI"] = writeFakeCli(tmpDir, envelope);

    const stdout = await captureStdout(async () => {
      await main(["--action", "get_issue", "--params", '{"issue_key":"FOO-1"}']);
    });
    const parsed = JSON.parse(stdout);
    expect(parsed).toEqual(envelope);
    expect(parsed.mermaid).toBeUndefined();
  });

  it("omits Mermaid for jql_search with no issues", async () => {
    const envelope = {
      status: "success",
      action: "jql_search",
      data: { issues: [] },
    };
    process.env["JIRA_AGENT_CLI"] = writeFakeCli(tmpDir, envelope);

    const stdout = await captureStdout(async () => {
      await main(["--action", "jql_search", "--params", '{"jql":"project = NONE"}']);
    });
    const parsed = JSON.parse(stdout);
    expect(parsed.mermaid).toBeUndefined();
  });
});
