/** Sidecar lifecycle: start/teardown per-run service containers networked to the session/grade container. */
import type { Runner } from "./exec.js";
import type { ServiceSpec } from "./types.js";

const READY_TIMEOUT_MS = 60_000;
const READY_POLL_MS = 2_000;

export function networkName(prefix: string): string {
  return `${prefix}-net`;
}

export function serviceContainerName(prefix: string, svc: ServiceSpec): string {
  return `${prefix}-svc-${svc.name}`;
}

export function networkCreateArgs(net: string): string[] {
  return ["network", "create", net];
}

export function serviceRunArgs(net: string, prefix: string, svc: ServiceSpec): string[] {
  const args = [
    "run", "-d", "--rm",
    "--name", serviceContainerName(prefix, svc),
    "--network", net,
    "--network-alias", svc.name,
    ...Object.entries(svc.env).flatMap(([k, v]) => ["-e", `${k}=${v}`]),
    svc.image,
  ];
  return args;
}

/** Returns argv arrays to tear down all service containers and the network. */
export function teardownArgs(net: string, prefix: string, services: ServiceSpec[]): string[][] {
  const cmds: string[][] = services.map((svc) => ["rm", "-f", serviceContainerName(prefix, svc)]);
  cmds.push(["network", "rm", net]);
  return cmds;
}

export async function startSidecars(runner: Runner, net: string, prefix: string, services: ServiceSpec[]): Promise<void> {
  if (services.length === 0) return;

  const netCreate = await runner("docker", networkCreateArgs(net));
  if (netCreate.code !== 0) {
    throw new Error(`docker network create "${net}" failed (exit ${netCreate.code}): ${netCreate.stderr.trim()}`);
  }

  for (const svc of services) {
    const containerName = serviceContainerName(prefix, svc);
    const run = await runner("docker", serviceRunArgs(net, prefix, svc));
    if (run.code !== 0) {
      throw new Error(`sidecar "${svc.name}" (${containerName}) failed to start (exit ${run.code}): ${run.stderr.trim()}`);
    }

    if (svc.ready !== undefined) {
      const ready = svc.ready;
      const deadline = Date.now() + READY_TIMEOUT_MS;
      let ready_ok = false;
      while (Date.now() < deadline) {
        const r = await runner("docker", ["exec", containerName, "sh", "-c", ready]);
        if (r.code === 0) { ready_ok = true; break; }
        await new Promise<void>((res) => setTimeout(res, READY_POLL_MS));
      }
      if (!ready_ok) {
        throw new Error(`sidecar "${svc.name}" (${containerName}) did not become ready within ${READY_TIMEOUT_MS / 1000}s`);
      }
    }
  }
}

export async function teardownSidecars(runner: Runner, net: string, prefix: string, services: ServiceSpec[]): Promise<void> {
  if (services.length === 0) return;
  for (const argv of teardownArgs(net, prefix, services)) {
    await runner("docker", argv).catch(() => { /* best-effort */ });
  }
}
