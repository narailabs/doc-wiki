/**
 * Tests for `parseAgentArgs` — the shared CLI parser extracted from
 * the six source-agent scripts. Pins the same behavior each hand-rolled
 * parser had (`--flag value`, `--flag=value`, `-h` / `--help`, throw on
 * unknown flag).
 */
import { describe, expect, it } from "vitest";

import { parseAgentArgs } from "../_agent_cli.js";

const STD_FLAGS = ["action", "params"];

describe("parseAgentArgs", () => {
  it("parses --action <value> --params <value>", () => {
    const r = parseAgentArgs(
      ["--action", "search", "--params", '{"q":"foo"}'],
      { flags: STD_FLAGS },
    );
    expect(r.action).toBe("search");
    expect(r.params).toBe('{"q":"foo"}');
    expect(r.help).toBeUndefined();
  });

  it("parses --flag=value form", () => {
    const r = parseAgentArgs(
      ["--action=get_page", '--params={"id":"1"}'],
      { flags: STD_FLAGS },
    );
    expect(r.action).toBe("get_page");
    expect(r.params).toBe('{"id":"1"}');
  });

  it("recognises --help", () => {
    expect(parseAgentArgs(["--help"], { flags: STD_FLAGS }).help).toBe(true);
  });

  it("recognises -h", () => {
    expect(parseAgentArgs(["-h"], { flags: STD_FLAGS }).help).toBe(true);
  });

  it("throws on unknown --flag", () => {
    expect(() =>
      parseAgentArgs(["--bogus", "x"], { flags: STD_FLAGS }),
    ).toThrow(/unrecognized argument: --bogus/);
  });

  it("throws on positional argument", () => {
    expect(() => parseAgentArgs(["get_page"], { flags: STD_FLAGS })).toThrow(
      /unrecognized argument: get_page/,
    );
  });

  it("treats a missing trailing value as empty string", () => {
    // `--action` with no following arg: the original hand-rolled parser
    // stored `""` (value fell through to `?? ""`) rather than undefined.
    const r = parseAgentArgs(["--action"], { flags: STD_FLAGS });
    expect(r.action).toBe("");
  });

  it("empty argv produces an empty result", () => {
    expect(parseAgentArgs([], { flags: STD_FLAGS })).toEqual({});
  });
});
