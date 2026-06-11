import { describe, expect, it } from "vitest";
import type { Runner } from "../exec.js";
import {
  networkCreateArgs,
  networkName,
  serviceContainerName,
  serviceRunArgs,
  startSidecars,
  teardownArgs,
  teardownSidecars,
} from "../services.js";
import type { ServiceSpec } from "../types.js";

const DB: ServiceSpec = {
  name: "db",
  image: "postgres:15-alpine",
  env: { POSTGRES_USER: "saleor", POSTGRES_PASSWORD: "saleor", POSTGRES_DB: "saleor" },
  ready: "pg_isready -U saleor",
};

const CACHE: ServiceSpec = {
  name: "cache",
  image: "valkey/valkey:8.1-alpine",
  env: {},
};

const PREFIX = "bench-saleor-42-wiki";

describe("pure argv builders", () => {
  it("networkName produces deterministic name", () => {
    expect(networkName(PREFIX)).toBe("bench-saleor-42-wiki-net");
  });

  it("serviceContainerName includes prefix and svc.name", () => {
    expect(serviceContainerName(PREFIX, DB)).toBe("bench-saleor-42-wiki-svc-db");
    expect(serviceContainerName(PREFIX, CACHE)).toBe("bench-saleor-42-wiki-svc-cache");
  });

  it("networkCreateArgs returns correct docker network create argv", () => {
    expect(networkCreateArgs("bench-saleor-42-wiki-net")).toEqual(["network", "create", "bench-saleor-42-wiki-net"]);
  });

  it("serviceRunArgs: detached, named, networked, aliased, with env, then image", () => {
    const net = networkName(PREFIX);
    const args = serviceRunArgs(net, PREFIX, DB);
    expect(args[0]).toBe("run");
    expect(args).toContain("-d");
    expect(args).toContain("--rm");
    expect(args).toContain("--name");
    expect(args[args.indexOf("--name") + 1]).toBe("bench-saleor-42-wiki-svc-db");
    expect(args).toContain("--network");
    expect(args[args.indexOf("--network") + 1]).toBe(net);
    expect(args).toContain("--network-alias");
    expect(args[args.indexOf("--network-alias") + 1]).toBe("db");
    // env vars
    expect(args).toContain("-e");
    expect(args).toContain("POSTGRES_USER=saleor");
    expect(args).toContain("POSTGRES_PASSWORD=saleor");
    expect(args).toContain("POSTGRES_DB=saleor");
    // image is last
    expect(args[args.length - 1]).toBe("postgres:15-alpine");
  });

  it("serviceRunArgs: no -e pairs when env is empty", () => {
    const net = networkName(PREFIX);
    const args = serviceRunArgs(net, PREFIX, CACHE);
    expect(args).not.toContain("-e");
    expect(args[args.length - 1]).toBe("valkey/valkey:8.1-alpine");
  });

  it("teardownArgs: one rm per service, then network rm, in order", () => {
    const net = networkName(PREFIX);
    const cmds = teardownArgs(net, PREFIX, [DB, CACHE]);
    expect(cmds).toHaveLength(3); // 2 rm + 1 network rm
    expect(cmds[0]).toEqual(["rm", "-f", "bench-saleor-42-wiki-svc-db"]);
    expect(cmds[1]).toEqual(["rm", "-f", "bench-saleor-42-wiki-svc-cache"]);
    expect(cmds[2]).toEqual(["network", "rm", net]);
  });
});

describe("startSidecars", () => {
  it("no-op when services list is empty", async () => {
    const calls: string[] = [];
    const runner: Runner = async (_cmd, args) => {
      calls.push(args[0] ?? "");
      return { code: 0, stdout: "", stderr: "" };
    };
    await startSidecars(runner, "net", PREFIX, []);
    expect(calls).toHaveLength(0);
  });

  it("creates network, starts each service, polls readiness in order", async () => {
    const calls: string[][] = [];
    const runner: Runner = async (_cmd, args) => {
      calls.push([...args]);
      return { code: 0, stdout: "", stderr: "" };
    };
    await startSidecars(runner, "mynet", PREFIX, [DB, CACHE]);

    // First call: network create
    expect(calls[0]).toEqual(["network", "create", "mynet"]);

    // Second: DB run
    expect(calls[1]?.[0]).toBe("run");
    expect(calls[1]).toContain("bench-saleor-42-wiki-svc-db");

    // Third: DB readiness probe (exec)
    expect(calls[2]?.[0]).toBe("exec");
    expect(calls[2]).toContain("bench-saleor-42-wiki-svc-db");
    expect(calls[2]).toContain("pg_isready -U saleor");

    // Fourth: CACHE run (no ready probe)
    expect(calls[3]?.[0]).toBe("run");
    expect(calls[3]).toContain("bench-saleor-42-wiki-svc-cache");

    // No fifth call (cache has no ready probe)
    expect(calls).toHaveLength(4);
  });

  it("retries readiness probe until exit 0 then continues", async () => {
    let probeCount = 0;
    const calls: string[][] = [];
    const runner: Runner = async (_cmd, args) => {
      calls.push([...args]);
      if (args[0] === "exec") {
        probeCount += 1;
        // Fail first probe, succeed second
        return { code: probeCount < 2 ? 1 : 0, stdout: "", stderr: "" };
      }
      return { code: 0, stdout: "", stderr: "" };
    };
    await startSidecars(runner, "mynet", PREFIX, [DB]);
    // network create + svc run + 2 exec probes
    const execCalls = calls.filter((a) => a[0] === "exec");
    expect(execCalls).toHaveLength(2);
    expect(probeCount).toBe(2);
  });

  it("throws when `network create` returns non-zero, including stderr", async () => {
    const calls: string[][] = [];
    const runner: Runner = async (_cmd, args) => {
      calls.push([...args]);
      if (args[0] === "network" && args[1] === "create") {
        return { code: 1, stdout: "", stderr: "Error: network with name already exists" };
      }
      return { code: 0, stdout: "", stderr: "" };
    };
    await expect(startSidecars(runner, "mynet", PREFIX, [DB])).rejects.toThrow(/already exists/);
    // It must throw BEFORE running any service container.
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual(["network", "create", "mynet"]);
  });

  it("throws when a `docker run -d` returns non-zero, including stderr", async () => {
    const calls: string[][] = [];
    const runner: Runner = async (_cmd, args) => {
      calls.push([...args]);
      if (args[0] === "run") {
        return { code: 125, stdout: "", stderr: "Error: pull access denied for postgres:15-alpine" };
      }
      return { code: 0, stdout: "", stderr: "" };
    };
    await expect(startSidecars(runner, "mynet", PREFIX, [DB])).rejects.toThrow(/pull access denied/);
    // network create + the failed run, then it throws BEFORE polling readiness.
    expect(calls[0]).toEqual(["network", "create", "mynet"]);
    expect(calls[1]?.[0]).toBe("run");
    expect(calls.find((a) => a[0] === "exec")).toBeUndefined();
  });

  it("thrown error identifies the failing service by name", async () => {
    const runner: Runner = async (_cmd, args) => {
      if (args[0] === "run") return { code: 1, stdout: "", stderr: "boom" };
      return { code: 0, stdout: "", stderr: "" };
    };
    await expect(startSidecars(runner, "mynet", PREFIX, [DB])).rejects.toThrow(/db/);
  });
});

describe("teardownSidecars", () => {
  it("no-op when services list is empty", async () => {
    const calls: string[] = [];
    const runner: Runner = async (_cmd, args) => {
      calls.push(args[0] ?? "");
      return { code: 0, stdout: "", stderr: "" };
    };
    await teardownSidecars(runner, "net", PREFIX, []);
    expect(calls).toHaveLength(0);
  });

  it("calls rm for each service then network rm, ignoring non-zero exits", async () => {
    const calls: string[][] = [];
    const runner: Runner = async (_cmd, args) => {
      calls.push([...args]);
      // Simulate all teardown calls failing (best-effort: should not throw)
      return { code: 1, stdout: "", stderr: "error" };
    };
    await expect(teardownSidecars(runner, "mynet", PREFIX, [DB, CACHE])).resolves.toBeUndefined();
    expect(calls[0]).toEqual(["rm", "-f", "bench-saleor-42-wiki-svc-db"]);
    expect(calls[1]).toEqual(["rm", "-f", "bench-saleor-42-wiki-svc-cache"]);
    expect(calls[2]).toEqual(["network", "rm", "mynet"]);
  });
});
