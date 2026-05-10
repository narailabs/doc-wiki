/**
 * Tests for parse_config.ts — ported from test_parse_config.py.
 *
 * Each Python `def test_*` becomes a Vitest `it()` block. CLI-invocation
 * tests shell out to the compiled parse_config.js, matching the Python
 * tests that subprocess out to parse_config.py.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import { parseConfig, ConfigFileNotFoundError } from "../parse_config.js";
import {
  SCRIPTS_DIR,
  makeTmpPath,
  cleanupTmpPath,
  writeConfigYaml,
} from "./fixtures.js";

const CLI = path.join(SCRIPTS_DIR, "parse_config.js");

function runCli(
  args: readonly string[],
): { stdout: string; stderr: string; status: number } {
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
      stdout: typeof err.stdout === "string" ? err.stdout : (err.stdout?.toString("utf-8") ?? ""),
      stderr: typeof err.stderr === "string" ? err.stderr : (err.stderr?.toString("utf-8") ?? ""),
      status: err.status ?? 1,
    };
  }
}

describe("TestParseConfig", () => {
  let tmpPath: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("parse-cfg-");
  });

  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  /** pytest fixture: valid_config_yaml */
  function writeValidConfig(): string {
    return writeConfigYaml(tmpPath, {
      wiki: {
        name: "My Docs",
        domain: "engineering",
        max_depth: 4,
      },
      autonomy: { mode: "balanced" },
      sources: { providers: { file: { type: "static" } } },
    });
  }

  /** pytest fixture: minimal_config_yaml */
  function writeMinimalConfig(): string {
    return writeConfigYaml(tmpPath, { wiki: { name: "Minimal Wiki" } });
  }

  it("parse_valid_config", () => {
    const result = parseConfig(writeValidConfig()) as {
      wiki: { name: string; domain: string; max_depth: number };
      autonomy: { mode: string };
    };
    expect(typeof result).toBe("object");
    expect(result.wiki.name).toBe("My Docs");
    expect(result.wiki.domain).toBe("engineering");
    expect(result.wiki.max_depth).toBe(4);
    expect(result.autonomy.mode).toBe("balanced");
  });

  it("default_values", () => {
    const result = parseConfig(writeMinimalConfig()) as {
      wiki: { max_depth: number; domain: string };
      autonomy: { mode: string };
    };
    expect(result.wiki.max_depth).toBe(3);
    expect(result.autonomy.mode).toBe("balanced");
    expect(result.wiki.domain).toBe("general");
  });

  it("required_wiki_section", () => {
    const p = writeConfigYaml(tmpPath, { autonomy: { mode: "balanced" } });
    expect(() => parseConfig(p)).toThrow(/wiki/);
  });

  it("required_wiki_name", () => {
    const p = writeConfigYaml(tmpPath, { wiki: { domain: "testing" } });
    expect(() => parseConfig(p)).toThrow(/name/);
  });

  it("invalid_yaml_raises", () => {
    const p = path.join(tmpPath, "wiki.config.yaml");
    fs.writeFileSync(p, "{{invalid: yaml: [unbalanced");
    expect(() => parseConfig(p)).toThrow(/[Yy]AML|[Pp]ars/);
  });

  it("missing_file_raises", () => {
    expect(() => parseConfig("/nonexistent/path/wiki.config.yaml")).toThrow(
      ConfigFileNotFoundError,
    );
  });

  it("output_is_valid_json", () => {
    const cfgPath = writeValidConfig();
    const result = runCli(["--config", cfgPath]);
    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.wiki.name).toBe("My Docs");
  });

  it("autonomy_modes_validated", () => {
    const p = writeConfigYaml(tmpPath, {
      wiki: { name: "X" },
      autonomy: { mode: "yolo" },
    });
    expect(() => parseConfig(p)).toThrow(/[Mm]ode|autonomy/);
  });
});

describe("ecosystem.readme", () => {
  let tmpPath: string;

  beforeEach(() => {
    tmpPath = makeTmpPath("parse-cfg-readme-");
  });

  afterEach(() => {
    cleanupTmpPath(tmpPath);
  });

  it("defaults when absent", () => {
    const p = writeConfigYaml(tmpPath, {
      wiki: { name: "X" },
      autonomy: { mode: "balanced" },
    });
    const cfg = parseConfig(p) as {
      ecosystem: {
        readme: {
          enabled: boolean;
          quickstart_depth: string;
          salvage_mode: string;
          insert_markers_on_init: boolean;
        };
      };
    };
    expect(cfg.ecosystem.readme).toEqual({
      enabled: true,
      quickstart_depth: "generous",
      salvage_mode: "balanced",
      insert_markers_on_init: true,
    });
  });

  it("auto autonomy mode maps salvage_mode to autonomous", () => {
    const p = writeConfigYaml(tmpPath, {
      wiki: { name: "X" },
      autonomy: { mode: "auto" },
    });
    const cfg = parseConfig(p) as { ecosystem: { readme: { salvage_mode: string } } };
    expect(cfg.ecosystem.readme.salvage_mode).toBe("autonomous");
  });

  it("respects enabled: false", () => {
    const p = writeConfigYaml(tmpPath, {
      wiki: { name: "X" },
      ecosystem: { readme: { enabled: false } },
    });
    const cfg = parseConfig(p) as { ecosystem: { readme: { enabled: boolean } } };
    expect(cfg.ecosystem.readme.enabled).toBe(false);
  });

  it("respects quickstart_depth: minimal", () => {
    const p = writeConfigYaml(tmpPath, {
      wiki: { name: "X" },
      ecosystem: { readme: { quickstart_depth: "minimal" } },
    });
    const cfg = parseConfig(p) as { ecosystem: { readme: { quickstart_depth: string } } };
    expect(cfg.ecosystem.readme.quickstart_depth).toBe("minimal");
  });

  it("rejects invalid quickstart_depth", () => {
    const p = writeConfigYaml(tmpPath, {
      wiki: { name: "X" },
      ecosystem: { readme: { quickstart_depth: "medium" } },
    });
    expect(() => parseConfig(p)).toThrow(/quickstart_depth/);
  });

  it("rejects invalid salvage_mode", () => {
    const p = writeConfigYaml(tmpPath, {
      wiki: { name: "X" },
      ecosystem: { readme: { salvage_mode: "yolo" } },
    });
    expect(() => parseConfig(p)).toThrow(/salvage_mode/);
  });

  it("rejects non-boolean enabled", () => {
    const p = writeConfigYaml(tmpPath, {
      wiki: { name: "t" },
      ecosystem: { readme: { enabled: "true" } },
    });
    expect(() => parseConfig(p)).toThrow(/enabled/);
  });

  it("rejects non-boolean insert_markers_on_init", () => {
    const p = writeConfigYaml(tmpPath, {
      wiki: { name: "t" },
      ecosystem: { readme: { insert_markers_on_init: 1 } },
    });
    expect(() => parseConfig(p)).toThrow(/insert_markers_on_init/);
  });

  it("preserves unknown fields in ecosystem.readme", () => {
    const p = writeConfigYaml(tmpPath, {
      wiki: { name: "t" },
      ecosystem: { readme: { custom_future_field: "hello" } },
    });
    const cfg = parseConfig(p) as {
      ecosystem: { readme: Record<string, unknown> };
    };
    expect(cfg.ecosystem.readme.custom_future_field).toBe("hello");
    expect(cfg.ecosystem.readme.enabled).toBe(true);
  });
});
