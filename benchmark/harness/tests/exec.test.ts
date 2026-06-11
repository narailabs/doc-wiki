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

describe("realRunner timeout", () => {
  it("enforces timeoutMs with SIGKILL even when the child ignores SIGTERM", async () => {
    // Without killSignal: "SIGKILL" the default SIGTERM is ignored by this child and the
    // await blocks for its full 8s lifetime instead of the 400ms deadline (bug #108 shape:
    // docker CLI proxying TERM to a container whose PID1 defers it).
    const t0 = Date.now();
    const r = await realRunner(
      "node",
      ["-e", 'process.on("SIGTERM", () => {}); setTimeout(() => {}, 8000);'],
      { timeoutMs: 400 },
    );
    expect(Date.now() - t0).toBeLessThan(4000);
    expect(r.code).not.toBe(0);
  });
});
