import { describe, expect, it } from "vitest";
import { realRunner } from "../exec.js";

describe("realRunner", () => {
  it("captures stdout and zero exit", async () => {
    const r = await realRunner("node", ["-e", "process.stdout.write('hi')"]);
    expect(r).toMatchObject({ code: 0, stdout: "hi" });
  });

  it("resolves (not rejects) on nonzero exit, with stderr", async () => {
    const r = await realRunner("node", ["-e", "console.error('boom'); process.exit(3)"]);
    expect(r.code).toBe(3);
    expect(r.stderr).toContain("boom");
  });
});

describe("realRunner error mapping", () => {
  it("maps ENOENT (missing binary) to code 1", async () => {
    const r = await realRunner("nonexistent-binary-xyz", []);
    expect(r.code).toBe(1);
  });
});
