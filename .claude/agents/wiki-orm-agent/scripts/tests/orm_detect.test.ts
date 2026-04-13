/**
 * Tests for orm_detect.ts — the wiki-orm-agent CLI shim.
 *
 * Exercises the shim end-to-end against the shipped JPA and Django fixtures
 * in lib/wiki_orm/tests/fixtures/. Both library-level (main()) and CLI-level
 * (spawn the compiled .js) paths are covered.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { main } from "../orm_detect.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SCRIPTS_DIR = path.resolve(__dirname, "..");
const CLI = path.join(SCRIPTS_DIR, "orm_detect.js");

const ORM_FIXTURES_DIR = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "lib",
  "wiki_orm",
  "tests",
  "fixtures",
);

function runCli(args: readonly string[]): {
  stdout: string;
  stderr: string;
  status: number;
} {
  try {
    const stdout = execFileSync("node", [CLI, ...args], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { stdout, stderr: "", status: 0 };
  } catch (e) {
    const err = e as NodeJS.ErrnoException & {
      status?: number;
      stdout?: Buffer | string;
      stderr?: Buffer | string;
    };
    return {
      stdout:
        typeof err.stdout === "string"
          ? err.stdout
          : (err.stdout?.toString("utf-8") ?? ""),
      stderr:
        typeof err.stderr === "string"
          ? err.stderr
          : (err.stderr?.toString("utf-8") ?? ""),
      status: err.status ?? 1,
    };
  }
}

function captureStdout(fn: () => void): string {
  const orig = process.stdout.write.bind(process.stdout);
  const chunks: string[] = [];
  process.stdout.write = ((s: string | Uint8Array): boolean => {
    chunks.push(typeof s === "string" ? s : Buffer.from(s).toString("utf-8"));
    return true;
  }) as typeof process.stdout.write;
  try {
    fn();
  } finally {
    process.stdout.write = orig;
  }
  return chunks.join("");
}

describe("orm_detect main()", () => {
  it("requires --codebase-path", () => {
    const origErr = process.stderr.write.bind(process.stderr);
    const errChunks: string[] = [];
    process.stderr.write = ((s: string | Uint8Array): boolean => {
      errChunks.push(
        typeof s === "string" ? s : Buffer.from(s).toString("utf-8"),
      );
      return true;
    }) as typeof process.stderr.write;
    try {
      const code = main([]);
      expect(code).toBe(2);
      expect(errChunks.join("")).toContain("--codebase-path");
    } finally {
      process.stderr.write = origErr;
    }
  });

  it("detects JPA profile on the JPA fixture and emits JSON", () => {
    const jpaPath = path.join(ORM_FIXTURES_DIR, "jpa");
    const stdout = captureStdout(() => {
      const code = main([
        "--codebase-path",
        jpaPath,
        "--profile",
        "auto",
        "--output-json",
      ]);
      expect(code).toBe(0);
    });
    const result = JSON.parse(stdout);
    expect(result.status).toBe("success");
    expect(result.orm_detected).toBe("jpa");
    const classNames = (result.entities as Array<{ class_name: string }>).map(
      (e) => e.class_name,
    );
    expect(classNames).toContain("User");
    expect(classNames).toContain("Order");
    expect(result.mermaid).not.toBeNull();
    expect(result.mermaid.code).toContain("erDiagram");
  });

  it("detects Django profile on the Django fixture", () => {
    const djangoPath = path.join(ORM_FIXTURES_DIR, "django");
    const stdout = captureStdout(() => {
      main([
        "--codebase-path",
        djangoPath,
        "--profile",
        "auto",
        "--output-json",
      ]);
    });
    const result = JSON.parse(stdout);
    expect(result.orm_detected).toBe("django");
    expect((result.entities as unknown[]).length).toBeGreaterThan(0);
  });

  it("writes database-mapping.md when --output-markdown is given", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "orm-detect-test-"));
    const outFile = path.join(tmp, "database-mapping.md");
    try {
      const jpaPath = path.join(ORM_FIXTURES_DIR, "jpa");
      const code = main([
        "--codebase-path",
        jpaPath,
        "--output-markdown",
        outFile,
      ]);
      expect(code).toBe(0);
      expect(fs.existsSync(outFile)).toBe(true);
      const content = fs.readFileSync(outFile, "utf-8");
      expect(content).toContain("erDiagram");
      expect(content).toContain("User");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("returns empty success result when no ORM is detected", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "orm-detect-empty-"));
    try {
      // Directory with no ORM-matching files
      fs.writeFileSync(path.join(tmp, "README.md"), "# Empty");
      const stdout = captureStdout(() => {
        main(["--codebase-path", tmp, "--output-json"]);
      });
      const result = JSON.parse(stdout);
      expect(result.status).toBe("success");
      expect(result.orm_detected).toBeNull();
      expect(result.entities).toEqual([]);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("orm_detect CLI", () => {
  let built = false;

  beforeEach(() => {
    // The CLI only exists after `npm run build`. Skip CLI tests if .js is absent.
    built = fs.existsSync(CLI);
  });

  afterEach(() => {
    // no-op
  });

  it("prints help with --help", () => {
    if (!built) return;
    const { stdout, status } = runCli(["--help"]);
    expect(status).toBe(0);
    expect(stdout).toContain("orm_detect");
    expect(stdout).toContain("--codebase-path");
  });

  it("detects JPA via CLI", () => {
    if (!built) return;
    const jpaPath = path.join(ORM_FIXTURES_DIR, "jpa");
    const { stdout, status } = runCli([
      "--codebase-path",
      jpaPath,
      "--output-json",
    ]);
    expect(status).toBe(0);
    const result = JSON.parse(stdout);
    expect(result.orm_detected).toBe("jpa");
  });
});
