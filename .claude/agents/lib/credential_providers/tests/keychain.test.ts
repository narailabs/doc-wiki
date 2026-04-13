/**
 * Tests for KeychainProvider. We mock `node:child_process.execFileSync`
 * so the suite never actually touches the host keychain.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
}));

import { execFileSync } from "node:child_process";
import { KeychainProvider } from "../keychain.js";

const execMock = execFileSync as unknown as ReturnType<typeof vi.fn>;

describe("credential_providers/keychain", () => {
  beforeEach(() => {
    execMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("macOS", () => {
    it("reads via `security find-generic-password -s <name> -w`", async () => {
      execMock.mockReturnValueOnce("secret-value\n");
      const p = new KeychainProvider({ platform: "darwin" });
      expect(await p.getSecret("MY_SECRET")).toBe("secret-value");
      expect(execMock).toHaveBeenCalledWith(
        "security",
        ["find-generic-password", "-s", "MY_SECRET", "-w"],
        expect.objectContaining({ encoding: "utf-8" }),
      );
    });

    it("passes -a <account> when provided", async () => {
      execMock.mockReturnValueOnce("val\n");
      const p = new KeychainProvider({
        platform: "darwin",
        account: "alice",
      });
      await p.getSecret("SECRET");
      expect(execMock).toHaveBeenCalledWith(
        "security",
        ["find-generic-password", "-a", "alice", "-s", "SECRET", "-w"],
        expect.any(Object),
      );
    });

    it("applies servicePrefix", async () => {
      execMock.mockReturnValueOnce("v\n");
      const p = new KeychainProvider({
        platform: "darwin",
        servicePrefix: "com.doc-wiki",
      });
      await p.getSecret("github");
      const [, args] = execMock.mock.calls[0] as [string, string[]];
      expect(args).toContain("com.doc-wiki.github");
    });

    it("returns null when security exits 44 (not-found)", async () => {
      const err = new Error("not found") as Error & { status?: number };
      err.status = 44;
      execMock.mockImplementationOnce(() => {
        throw err;
      });
      const p = new KeychainProvider({ platform: "darwin" });
      expect(await p.getSecret("absent")).toBeNull();
    });

    it("throws wrapped error on other failures", async () => {
      const err = new Error("denied") as Error & {
        status?: number;
        stderr?: string;
      };
      err.status = 50;
      err.stderr = "permission denied";
      execMock.mockImplementationOnce(() => {
        throw err;
      });
      const p = new KeychainProvider({ platform: "darwin" });
      await expect(p.getSecret("x")).rejects.toThrow(
        /security failed \(status=50\): permission denied/,
      );
    });
  });

  describe("Linux", () => {
    it("reads via `secret-tool lookup name <name>`", async () => {
      execMock.mockReturnValueOnce("linux-secret\n");
      const p = new KeychainProvider({ platform: "linux" });
      expect(await p.getSecret("MY_SECRET")).toBe("linux-secret");
      expect(execMock).toHaveBeenCalledWith(
        "secret-tool",
        ["lookup", "name", "MY_SECRET"],
        expect.any(Object),
      );
    });

    it("throws a helpful error when secret-tool is missing", async () => {
      const err = new Error("not found") as Error & { code?: string };
      err.code = "ENOENT";
      execMock.mockImplementationOnce(() => {
        throw err;
      });
      const p = new KeychainProvider({ platform: "linux" });
      await expect(p.getSecret("x")).rejects.toThrow(/libsecret/);
    });

    it("returns null when secret-tool exits 1 (miss)", async () => {
      const err = new Error("miss") as Error & { status?: number };
      err.status = 1;
      execMock.mockImplementationOnce(() => {
        throw err;
      });
      const p = new KeychainProvider({ platform: "linux" });
      expect(await p.getSecret("absent")).toBeNull();
    });
  });

  describe("unsupported platforms", () => {
    it("throws on Windows", async () => {
      const p = new KeychainProvider({ platform: "win32" });
      await expect(p.getSecret("x")).rejects.toThrow(
        /keychain provider unsupported on Windows/,
      );
    });

    it("throws on other platforms", async () => {
      const p = new KeychainProvider({ platform: "aix" });
      await expect(p.getSecret("x")).rejects.toThrow(/aix/);
    });
  });
});
