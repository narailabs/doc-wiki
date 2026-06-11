import { describe, expect, it } from "vitest";
import { dispatch } from "../cli.js";

describe("cli dispatch", () => {
  it("routes known subcommands and rejects unknown ones", async () => {
    expect(await dispatch(["definitely-not-a-command"])).toBe(2);
    expect(await dispatch([])).toBe(2);
    expect(await dispatch(["mine", "--help"])).toBe(0);
    expect(await dispatch(["run", "--help"])).toBe(0);
    expect(await dispatch(["grade", "--help"])).toBe(0);
    expect(await dispatch(["calibrate", "--help"])).toBe(0);
    expect(await dispatch(["report", "--help"])).toBe(0);
    expect(await dispatch(["build-wiki", "--help"])).toBe(0);
    expect(await dispatch(["build-image", "--help"])).toBe(0);
  });
});
