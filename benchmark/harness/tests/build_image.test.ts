import { describe, expect, it } from "vitest";
import { imageBuildArgs } from "../build_image.js";
import { loadRepoConfig } from "../repo_config.js";

describe("imageBuildArgs", () => {
  it("bakes system_packages into EXTRA_APT for saleor", () => {
    const cfg = loadRepoConfig("benchmark/repos/saleor.yaml");
    const args = imageBuildArgs(cfg);
    expect(args).toEqual([
      "build", "-t", "docwiki-bench-saleor",
      "--build-arg", "TOOLCHAIN=node:22",
      "--build-arg", "EXTRA_APT=libpq-dev",
      "benchmark/harness/docker",
    ]);
  });

  it("omits EXTRA_APT when system_packages is empty (vitest)", () => {
    const cfg = loadRepoConfig("benchmark/repos/vitest.yaml");
    const args = imageBuildArgs(cfg);
    expect(args).toEqual([
      "build", "-t", "docwiki-bench-vitest",
      "--build-arg", "TOOLCHAIN=node:22",
      "benchmark/harness/docker",
    ]);
    expect(args.join(" ")).not.toContain("EXTRA_APT");
  });

  it("derives the image tag from the repo id and toolchain[0]", () => {
    const cfg = loadRepoConfig("benchmark/repos/saleor.yaml");
    const args = imageBuildArgs(cfg);
    expect(args[args.indexOf("-t") + 1]).toBe("docwiki-bench-saleor");
    expect(args).toContain("TOOLCHAIN=node:22");
  });
});
